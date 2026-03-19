# TeleCare 后端开发任务清单

## 已完成

- [x] 项目基础架构（NestJS + Prisma + Redis + JWT）
- [x] 全局统一响应格式（TransformInterceptor）
- [x] 全局异常过滤器（HttpExceptionFilter）
- [x] AuthModule：守护端/老人端注册、登录、JWT 签发（含角色校验）
- [x] DeviceModule：配对码生成（Redis TTL 300s）、守护端扫码绑定（Prisma 事务）、守护端单绑限制
- [x] FamilyModule：获取家庭成员列表（守护端查老人 / 老人端查守护者）、解绑逻辑

---

## 待开发

### T1 — SignalingModule（WebSocket 网关）
> 优先级：高 | 依赖：AuthModule、FamilyModule

- [ ] 创建 `src/signaling/signaling.module.ts`
- [ ] 创建 `src/signaling/signaling.gateway.ts`，命名空间 `/care`
- [ ] WebSocket 鉴权：连接时校验 JWT，注入 userId / familyId，加入房间 `family_{familyId}`
- [ ] 实现 `heartbeat` 事件：更新 Redis `device_status:{deviceUuid}`（socketId、battery、status），续期 60s
- [ ] 实现 `bind_success` 事件：绑定 API 成功后向老人端 socketId 定向推送
- [ ] 实现 `call_guardian` 事件：老人主动呼叫，转发给守护端
- [ ] 实现 `request_assist` 事件：守护端发起协助，转发给老人端
- [ ] 实现 `assist_reply` 事件：老人回传 accept，转发给守护端
- [ ] WebRTC 信令透传：`webrtc_offer` / `webrtc_answer` / `webrtc_ice` / `call_end`（按 targetId 定向转发）
- [ ] 实现 `remote_command` 事件：守护端手势指令转发给老人端
- [ ] 在 `main.ts` 挂载 Socket.io adapter

---

### T2 — Dashboard 接口
> 优先级：高 | 依赖：FamilyModule、SignalingModule（在线状态）

- [ ] `GET /api/family/dashboard`：聚合返回当前守护端绑定的老人信息
  - 老人基础信息（name、phone）
  - 设备在线状态（从 Redis `device_status:{deviceUuid}` 读取）
  - 电量、最后在线时间

---

### T3 — LocationModule（历史轨迹）
> 优先级：中 | 依赖：SignalingModule（设备上报入口）

- [ ] 创建 `src/location/` 模块
- [ ] `GET /api/location/history/:deviceId`：查询 LocationTrack 表，支持 Query 参数 `startTime` / `endTime`
- [ ] 老人端通过 WebSocket 或 REST 上报位置，写入 LocationTrack 表（建议在 heartbeat 或独立事件中处理）

---

### T4 — ConfigModule（远程配置）
> 优先级：中 | 依赖：SignalingModule（sync_config 下发）

- [ ] 创建 `src/config/` 模块（注意避免与 NestJS 内置 ConfigModule 命名冲突，可命名为 DeviceConfigModule）
- [ ] `GET /api/config/:deviceId`：读取 RemoteConfig 表
- [ ] `PUT /api/config/:deviceId`：更新 RemoteConfig，成功后通过 Socket 向老人端推送 `sync_config` 事件
- [ ] 鉴权：仅允许该设备所属家庭的守护端操作

---

### T5 — bind_success Socket 推送补全
> 优先级：高 | 依赖：T1 SignalingModule

- [ ] `DeviceService.bindDevice` 绑定成功后，调用 SignalingGateway 向老人端推送 `bind_success: { familyId }`
- [ ] 需将 SignalingGateway 注入到 DeviceModule（注意循环依赖处理）

---

### T6 — Schema 与数据库补全
> 优先级：低（按需）

- [ ] `FamilyMember` 的 `role` 字段当前是 `String`，建议改为使用已有的 `UserRole` 枚举，保持类型一致
- [ ] 评估是否需要在 `FamilyMember` 增加 `nickname` 字段（守护者给老人起的备注名）
- [ ] `ElderDevice` 与 `User`（老人账号）目前通过 `FamilyMember` 间接关联，确认是否需要直接外键

---

## 开发顺序建议

```
T1 SignalingModule → T5 bind_success 补全 → T2 Dashboard → T3 Location → T4 Config → T6 Schema 优化
```
