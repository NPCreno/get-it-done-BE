import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class LoginUsernameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
