一、 系统架构与依赖声明

1.1 技术栈规范
- 核心框架: NestJS (TypeScript)
- 数据库: MySQL 8.0
- ORM框架: Prisma (@prisma/client)
- 缓存与状态: Redis (ioredis)
- 实时通信: Socket.io (@nestjs/websockets, @nestjs/platform-socket.io)
- 鉴权体系: JWT (@nestjs/jwt, passport-jwt)
  
1.2 核心模块划分 (Nest Modules)
- AuthModule: 守护端用户的注册、登录与 JWT 签发。
- DeviceModule: 老人设备的注册、配对码生成与校验（结合 Redis）。
- FamilyModule: 家庭域管理、设备列表拉取、首页 Dashboard 数据聚合。
- SignalingModule: WebSocket 实时网关，处理 WebRTC 信令、远程控制指令、SOS 广播。
- LocationModule: 历史轨迹数据的记录与查询。
- ConfigModule: 远程设备参数（音量、亮度、吃药提醒）的下发与持久化。
  

---

二、 数据库模型设计 (Prisma Schema)

请使用以下 schema.prisma 文件初始化数据库结构。

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// 守护端用户表
model User {
  id        String         @id @default(uuid())
  phone     String         @unique
  password  String         // 需使用 bcrypt 进行 hash 处理
  name      String?
  createdAt DateTime       @default(now())
  families  FamilyMember[]
}

// 老人设备端表
model ElderDevice {
  id          String         @id @default(uuid())
  deviceUuid  String         @unique // 安卓设备的唯一硬件标识
  familyId    String?
  nickname    String         @default("老人")
  battery     Int            @default(100)
  lastOnline  DateTime       @default(now())
  createdAt   DateTime       @default(now())
  
  family      Family?        @relation(fields: [familyId], references: [id])
  locations   LocationTrack[]
  config      RemoteConfig?
}

// 家庭域表 (核心业务边界)
model Family {
  id        String         @id @default(uuid())
  createdAt DateTime       @default(now())
  members   FamilyMember[]
  devices   ElderDevice[]
}

// 守护者与家庭的关联表 (多对多)
model FamilyMember {
  userId   String
  familyId String
  role     String         @default("GUARDIAN") // 权限角色划分
  user     User           @relation(fields: [userId], references: [id])
  family   Family         @relation(fields: [familyId], references: [id])
  
  @@id([userId, familyId])
}

// 历史轨迹表
model LocationTrack {
  id        String         @id @default(uuid())
  deviceId  String
  lat       Float
  lng       Float
  timestamp DateTime       @default(now())
  device    ElderDevice    @relation(fields: [deviceId], references: [id])
}

// 远程配置表
model RemoteConfig {
  id               String      @id @default(uuid())
  deviceId         String      @unique
  volume           Int         @default(50)
  brightness       Int         @default(50)
  medicineReminder Json?       // 格式: [{"time": "08:00", "text": "吃降压药"}]
  allowedApps      Json?       // 格式: ["com.tencent.mm", "com.android.phone"]
  device           ElderDevice @relation(fields: [deviceId], references: [id])
}


---

三、 Redis 数据结构设计 (核心状态管理)

用于处理高频状态更新与带过期时间（TTL）的临时业务逻辑。

Redis Key 规则
数据类型
过期时间 (TTL)
业务场景
详细说明
bind_code:{6位数字}
String
300秒 (5分钟)
设备绑定流程
Value 存储 deviceUuid。过期自动销毁，防止配对码被暴力破解。
device_status:{deviceUuid}
Hash
60秒
全局在线状态
存储字段包括 socketId, battery, status (如 IDLE/CALLING)。由心跳包持续续期。
sos_lock:{deviceUuid}
String
30秒
SOS 防误触
分布式锁机制，防止老人在短时间内多次触发连续的 SOS 报警推送。


---

四、 RESTful API 接口定义 (控制面)

统一返回格式约定：{ "code": 200, "message": "success", "data": { ... } }

4.1 账号与鉴权 (Auth)
接口路径
请求方式
请求参数 (Body)
响应数据 (Data)
对应 UI 页面
/api/auth/login
POST
phone, password
{ token, user }
守护端 Login
/api/auth/register
POST
phone, password, name
{ token, user }
守护端 Login (注册分支)

4.2 设备绑定逻辑 (Binding)
接口路径
请求方式
请求头 (Headers)
请求参数 (Body)
响应数据 (Data)
对应 UI 页面
/api/bind/generate
POST
无需鉴权
deviceUuid
{ pairCode: "123456", expiresIn: 300 }
老人端 Binding
/api/bind/verify
POST
Authorization: Bearer {token}
pairCode, nickname
{ familyId, deviceId }
守护端 ScanQR

业务逻辑说明：/verify 接口需先查询 Redis 中的 bind_code，验证通过后在 MySQL 中开启 Prisma 事务（Transaction）创建 Family 并关联设备与用户，最后删除 Redis Key，并通过 Socket 向老人端定向发送 bind_success 事件。

4.3 守护主页数据 (Dashboard)
接口路径
请求方式
请求头 (Headers)
请求参数
响应数据 (Data)
对应 UI 页面
/api/family/dashboard
GET
Authorization: Bearer {token}
无
{ devices: [...], stats: {...} }
守护端 Dashboard

4.4 辅助功能 (Location & Config)
接口路径
请求方式
请求参数 / Body
响应数据 (Data)
对应 UI 页面
/api/location/history/:deviceId
GET
Query: startTime, endTime
[{lat, lng, timestamp}]
守护端 MapMonitor
/api/config/:deviceId
GET
Params: deviceId
{ volume, brightness, medicineReminder }
守护端 RemoteConfig
/api/config/:deviceId
PUT
Body: { volume, brightness }
{ success: true }
守护端 RemoteConfig


---

五、 WebSocket 实时通信协议 (实时面)

- 命名空间 (Namespace): /care
- 房间策略 (Room): 鉴权通过后，客户端自动加入名为 family_{familyId} 的房间，实现家庭域内的消息隔离广播。
  
5.1 基础与保活事件
事件名 (Event)
发送方
接收方
Payload (数据载荷)
业务逻辑处理
heartbeat
老人端
后端
{ battery, netType }
后端更新 Redis 的 device_status 并续期 60s。
bind_success
后端
老人端
{ familyId }
绑定 API 成功后，后端定向下发，老人端收到后跳转 Home。

5.2 呼叫与 SOS (高优先级交互)
事件名 (Event)
发送方
接收方
Payload (数据载荷)
业务逻辑处理
sos_trigger
老人端
守护端
{ lat, lng, battery }
后端收到后向 family_{familyId} 广播。守护端弹出全屏接听页并播放警报。
call_guardian
老人端
守护端
{ deviceId }
老人主动呼叫。守护端弹出 IncomingCall 页面。
request_assist
守护端
老人端
{ guardianId, name }
守护端发起协助。老人端弹出 CallWait 并显示同意/拒绝。
assist_reply
老人端
守护端
{ accept: boolean }
老人点击同意/拒绝后回传。若为 true，双方准备建立 WebRTC。

5.3 WebRTC 信令 (网关透明转发)
后端不解析 SDP 和 Candidate 详情，仅做同房间内的信令透传。
事件名 (Event)
发送方
接收方
Payload (数据载荷)
webrtc_offer
发起方
接收方
{ targetId, sdp }
webrtc_answer
接收方
发起方
{ targetId, sdp }
webrtc_ice
双方
对方
{ targetId, candidate }
call_end
挂断方
对方
{ reason: "hangup_by_user" }

5.4 远程控制指令
事件名 (Event)
发送方
接收方
Payload (数据载荷)
对应 UI 交互
remote_command
守护端
老人端
{ action: "CLICK/SCROLL/TEXT", params: {x, y, text} }
RemoteConsole 守护端手势操作映射
sync_config
后端
老人端
{ volume: 80, brightness: 60 }
守护端调用 PUT 配置 API 后，后端通过 Socket 实时下发至老人端静默执行。


---

六、 容器化部署方案 (Docker Compose)

将以下代码保存为 docker-compose.yml，放置在后端项目根目录，即可实现 API 服务、MySQL 数据库、Redis 缓存的一键启动。

version: '3.8'

services:
  # NestJS 后端 API & WebSocket 服务
  nest-api:
    build: .
    container_name: care_backend
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=mysql://root:care_pwd_2024@mysql-db:3306/care_db
      - REDIS_URL=redis://redis-cache:6379
      - JWT_SECRET=your_super_secret_key_for_jwt
    depends_on:
      mysql-db:
        condition: service_healthy
      redis-cache:
        condition: service_started

  # MySQL 8.0 数据库
  mysql-db:
    image: mysql:8.0
    container_name: care_mysql
    restart: always
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: care_pwd_2024
      MYSQL_DATABASE: care_db
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis 缓存服务
  redis-cache:
    image: redis:alpine
    container_name: care_redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mysql_data:
  redis_data: