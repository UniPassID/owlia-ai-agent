import { Column, Entity, Index } from "typeorm";

@Index("wallet_uk", ["wallet"], { unique: true })
@Entity("user_v2", { schema: "defi_agent" })
export class UserV2 {
  @Column("varchar", { primary: true, name: "id", length: 36 })
  id: string;

  @Column("varbinary", { name: "wallet", unique: true, length: 32 })
  wallet: Buffer;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @Column("datetime", { name: "updatedAt" })
  updatedAt: Date;
}

export enum UserV2Status {
  init = 0,
  setGuardSuccess = 1,
}
