import { Column, Entity, Index } from 'typeorm';

@Index('owner_uk', ['owner'], { unique: true })
@Entity('users')
export class User {
  @Column('binary', { primary: true, name: 'id', length: 16 })
  id: Buffer;

  @Column('varbinary', { name: 'owner', unique: true, length: 32 })
  owner: Buffer;

  @Column('datetime', { name: 'createdAt' })
  createdAt: Date;

  @Column('datetime', { name: 'updatedAt' })
  updatedAt: Date;
}
