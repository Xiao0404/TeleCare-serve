<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

TeleCare 服务端，负责认证、家庭绑定、位置/电子围栏、远程设置，以及远程协助的 Socket 信令转发。

## Project setup

```bash
$ npm install
```

## Environment

在项目根目录创建或维护 `.env`：

```env
DATABASE_URL="mysql://root:123456@localhost:3306/care_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="123456"
PORT=3500
AMAP_WEB_API_KEY="你的高德 Web 服务 key"
TURN_PUBLIC_HOST="159.75.70.82"
TURN_EXTERNAL_IP="159.75.70.82"
WEBRTC_TURN_USERNAME="telecare"
WEBRTC_TURN_CREDENTIAL="replace-with-your-turn-password"
```

## WebRTC / TURN

远程协助的视频流现在支持从服务端动态下发 `iceServers`。如果不配置，客户端会退回到默认 STUN：

```env
WEBRTC_STUN_URLS="stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
WEBRTC_TURN_URLS="turn:your-turn-host:3478?transport=udp,turn:your-turn-host:3478?transport=tcp"
WEBRTC_TURN_USERNAME="telecare"
WEBRTC_TURN_CREDENTIAL="replace-with-your-turn-password"
```

如果直接使用腾讯云公网 IP 做第一轮异地真机测试，`your-turn-host` 就填服务器公网 IP，例如 `159.75.70.82`。

也可以直接使用 JSON：

```env
WEBRTC_ICE_SERVERS_JSON=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:your-turn-host:3478?transport=udp"],"username":"telecare","credential":"replace-with-your-turn-password"}]
```

调试时可以通过下面的接口确认服务端实际下发内容：

```bash
GET /api/signaling/webrtc-config
```

如果远程协助出现以下现象，优先检查 TURN：

- 守护端能收到 `ontrack`，但 `Frames received: 0`
- 双端最终进入 `iceConnectionState: failed`
- 指令偶尔能通，但实时画面黑屏

本地开发如果要快速验证 TURN，可以先起一个 `coturn` 服务，再把上面的 `WEBRTC_TURN_*` 环境变量指向它。一个常见做法是直接运行官方 Docker 镜像：

```bash
docker run -d --name telecare-coturn \
  -p 3478:3478 \
  -p 3478:3478/udp \
  -p 5349:5349 \
  -p 5349:5349/udp \
  coturn/coturn \
  -n --log-file=stdout \
  --lt-cred-mech \
  --fingerprint \
  --realm=telecare.local \
  --user=telecare:replace-with-your-turn-password
```

完成后把 `.env` 中的 `WEBRTC_TURN_URLS / WEBRTC_TURN_USERNAME / WEBRTC_TURN_CREDENTIAL` 填好，重启服务端即可。

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

### Tencent Cloud Docker 部署

当前仓库已经按 Docker Compose 方式整理好，适合直接上传到腾讯云 CVM 后部署。

注意：

- `nest-api` 容器启动时会先执行 `npx prisma db push`，用于首次建表和后续非破坏性同步。
- `mysql-db` 和 `redis-cache` 只在 Docker 内部网络暴露，不再默认映射到宿主机公网。
- 如果服务器公网 IP 不是 `159.75.70.82`，记得同步修改客户端里的 `src/config/network.ts`。

#### 1. 服务器准备

推荐系统：Ubuntu 22.04 LTS

安装 Docker：

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
```

可选：把当前用户加入 docker 组，避免每次都写 `sudo`。

```bash
sudo usermod -aG docker $USER
newgrp docker
```

#### 2. 上传项目

把整个 `TeleCare-serve` 目录压缩后上传到服务器，例如放到：

```bash
/home/ubuntu/TeleCare-serve
```

解压后进入目录：

```bash
cd /home/ubuntu/TeleCare-serve
```

#### 3. 修改生产环境变量

编辑根目录 `.env`，至少确认这些值：

```env
NODE_ENV=production
PORT=3500

MYSQL_ROOT_PASSWORD=请改成强密码
MYSQL_DATABASE=care_db
DATABASE_URL="mysql://root:请改成强密码@mysql-db:3306/care_db"

REDIS_URL="redis://redis-cache:6379"
JWT_SECRET="请改成强随机字符串"

TURN_PUBLIC_HOST="你的腾讯云公网IP"
TURN_EXTERNAL_IP="你的腾讯云公网IP"
TURN_RELAY_IP="172.30.0.10"

WEBRTC_TURN_URLS="turn:你的腾讯云公网IP:3478?transport=udp,turn:你的腾讯云公网IP:3478?transport=tcp"
WEBRTC_TURN_USERNAME="telecare"
WEBRTC_TURN_CREDENTIAL="请改成强密码"
```

#### 4. 配置腾讯云安全组

至少放通这些端口：

- `3500/TCP`：后端 API / WebSocket
- `3478/TCP`
- `3478/UDP`
- `49160-49200/UDP`：TURN 中继端口范围

不建议放通：

- `3306/TCP`
- `6379/TCP`

#### 5. 启动服务

首次部署直接执行：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看后端日志：

```bash
docker compose logs -f nest-api
```

#### 6. 常用运维命令

重建并重启：

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

仅重启后端：

```bash
docker compose restart nest-api
```

查看数据卷：

```bash
docker volume ls
```

#### 7. 验证是否部署成功

服务启动后可以检查：

```bash
curl http://你的公网IP:3500/api
curl http://你的公网IP:3500/api/signaling/webrtc-config
```

如果 `nest-api` 容器反复重启，优先看：

```bash
docker compose logs --tail=200 nest-api
docker compose logs --tail=200 mysql-db
```

常见原因：

- `.env` 中的 `DATABASE_URL`、`JWT_SECRET`、TURN 配置没改
- 腾讯云安全组没有放通 `3478` 和 `49160-49200/udp`
- 客户端仍然指向旧的服务器 IP

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
