import { UserEntity } from 'src/user/models/user.entity';
import { User } from 'src/user/models/user.interface';

/**
 * Explicit allowlist of what goes into a JWT. Never spread the entity: it
 * carries the password hash. Shared by login and refresh so they cannot drift.
 */
export function toTokenUser(entity: UserEntity): User {
  const [firstname, ...lastnameParts] = entity.fullname?.split(' ') || [];
  return {
    user_id: entity.user_id,
    fullname: entity.fullname,
    username: entity.username,
    email: entity.email,
    tier: entity.tier,
    role: entity.role,
    status: entity.status,
    theme: entity.theme,
    enableNotifications: entity.enableNotifications,
    soundFx: entity.soundFx,
    firstname: firstname || '',
    lastname: lastnameParts.join(' '),
  } as unknown as User;
}
