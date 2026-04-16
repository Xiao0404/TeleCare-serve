# TeleCare 服务端当前状态与后续任务

> 更新时间：2026-03-23
> 适用范围：`D:\work\TeleCare-serve`

---

## 1. 当前已落地能力

### 基础能力

- [x] NestJS + Prisma + Redis + JWT 基础架构
- [x] 全局响应拦截器
- [x] 全局异常过滤器
- [x] `main.ts` 挂载 Socket.io adapter

### AuthModule

- [x] 老人端 / 守护端注册
- [x] 老人端 / 守护端登录
- [x] JWT 鉴权
- [x] 角色校验

### DeviceModule

- [x] 配对码生成
- [x] 配对码校验
- [x] 守护端绑定老人
- [x] 守护端单绑限制
- [x] 绑定后将老人当前设备补挂到 family

### FamilyModule

- [x] 查询家庭成员
- [x] 解绑逻辑
- [x] `GET /api/family/dashboard`
- [x] Dashboard 聚合在线状态、电量、最后在线时间

### SignalingModule

- [x] `/care` 命名空间
- [x] WebSocket JWT 鉴权
- [x] 连接后按 family 加入 room
- [x] `heartbeat`
- [x] `sos_trigger`
- [x] `call_guardian`
- [x] `request_assist`
- [x] `assist_reply`
- [x] `webrtc_offer`
- [x] `webrtc_answer`
- [x] `webrtc_ice`
- [x] `call_end`
- [x] `remote_command`
- [x] `bind_success` 定向推送能力

---

## 2. 当前进行中的工作

### A. 远程协助协议收口

当前仍需继续处理：

- [ ] 统一 `sessionId` / `targetId` / `targetSocketId` / `deviceId` 字段口径
- [ ] 减少守护端、老人端、服务端对目标标识的混用
- [ ] 继续完善协助会话状态清理
- [ ] 评估是否需要更清晰的会话状态机

### B. Dashboard / 设备聚合细节

- [x] 从 Redis 读取在线状态
- [x] 从设备表读取兜底电量和在线时间
- [ ] 评估一个 family 多设备场景下的聚合策略
- [ ] 评估是否需要更明确的“当前登录设备”定义

---

## 3. 尚未完成的模块

### LocationModule

当前状态：未落地

- [ ] 正式实现 `src/location/` 模块
- [ ] 设计位置上报入口
- [ ] 落地历史轨迹查询接口
- [ ] 明确时间范围和分页策略

### DeviceConfig / RemoteConfig

当前状态：未落地

- [ ] 实现读取配置接口
- [ ] 实现更新配置接口
- [ ] 更新后下发 `sync_config`
- [ ] 做好家庭归属鉴权

### SOS 增强

当前状态：基础事件已在

- [x] 广播逻辑
- [x] 防抖锁
- [ ] 如有必要增加最近一次 SOS 记录
- [ ] 与守护端高优先级提醒页对齐字段

---

## 4. 需要继续关注的设计点

- [ ] `FamilyMember.role` 当前仍为字符串，后续建议收敛到枚举
- [ ] 是否需要支持一个老人账号下的多设备策略
- [ ] 是否要把协助会话持久化，还是继续维持内存态
- [ ] 后续真实 WebRTC 接入时，是否需要 TURN / ICE 配置下发接口

---

## 5. 建议的后续顺序

1. 继续统一远程协助协议和状态回收
2. 落地 LocationModule
3. 落地 RemoteConfig 模块
4. 补 SOS 增强与异常状态处理
5. 视需要推进 schema 优化

---

## 6. 一句话总结

服务端当前已经具备支撑 TeleCare MVP 联调的核心能力，下一阶段重点不是“从零搭模块”，而是继续收口远程协助协议，并补齐位置、配置和告警增强能力。
