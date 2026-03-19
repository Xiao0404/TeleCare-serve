import { Injectable, UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  async validateUser(phone: string, pass: string): Promise<any> {
    const user = await this.userService.findByPhone(phone);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByPhone(loginDto.phone);

    if (!user) {
      throw new UnauthorizedException('手机号或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('手机号或密码错误');
    }

    if (user.role !== loginDto.clientRole) {
      throw new ForbiddenException('角色不匹配，请使用正确的客户端登录');
    }

    await this.userService.updateDeviceId(user.id, loginDto.deviceId);

    const payload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      deviceId: loginDto.deviceId,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        deviceId: loginDto.deviceId,
      },
    };
  }

  async register(createUserDto: CreateUserDto) {
    const existingUser = await this.userService.findByPhone(createUserDto.phone);
    if (existingUser) {
      throw new ConflictException('该手机号已注册');
    }

    const user = await this.userService.create(createUserDto);
    const payload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      deviceId: user.deviceId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        deviceId: user.deviceId,
      },
    };
  }
}
