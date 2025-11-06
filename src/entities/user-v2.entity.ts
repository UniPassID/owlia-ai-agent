import { Column, Entity, Index } from "typeorm";

@Index("wallet_uk", ["chainId", "wallet"], { unique: true })
@Index("address_uk", ["chainId", "address"], { unique: true })
@Entity("users_v2", { schema: "defi_agent" })
export class UserV2 {
  @Column("varchar", { primary: true, name: "id", length: 36 })
  id: string;

  @Column("int", { name: "chainId" })
  chainId: number;

  @Column("varbinary", { name: "wallet", unique: true, length: 32 })
  wallet: Buffer;

  @Column("varbinary", { name: "address", unique: true, length: 32 })
  address: Buffer;

  @Column("varbinary", { name: "operator", length: 32 })
  operator: Buffer;

  @Column("varbinary", { name: "guard", length: 32 })
  guard: Buffer;

  @Column("varbinary", { name: "setGuardSignature", length: 128 })
  setGuardSignature: Buffer;

  @Column("tinyint", { name: "status" })
  status: UserV2Status;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @Column("datetime", { name: "updatedAt" })
  updatedAt: Date;
}

export enum UserV2Status {
  init = 0,
  setGuardSuccess = 1,
}
