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

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

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
