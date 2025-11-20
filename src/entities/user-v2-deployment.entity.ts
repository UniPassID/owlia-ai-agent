import { Column, Entity, Index } from "typeorm";

@Index("user_id_chain_id_uk", ["userId", "chainId"], { unique: true })
@Entity("user_v2_deployments", { schema: "defi_agent" })
export class UserV2Deployment {
  @Column("varchar", { primary: true, name: "id", length: 36 })
  id: string;

  @Column("varchar", { name: "userId", length: 36 })
  userId: string;

  @Column("int", { name: "chainId" })
  chainId: number;

  @Column("varbinary", { name: "address", length: 32 })
  address: Buffer;

  @Column("varbinary", { name: "operator", length: 32 })
  operator: Buffer;

  @Column("varbinary", { name: "guard", length: 32 })
  guard: Buffer;

  @Column("varbinary", {
    name: "setGuardSignature",
    length: 128,
    nullable: true,
  })
  setGuardSignature: Buffer | null;

  @Column("tinyint", { name: "status" })
  status: UserV2DeploymentStatus;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @Column("datetime", { name: "updatedAt" })
  updatedAt: Date;
}

export enum UserV2DeploymentStatus {
  uninitialized = 0,
  init = 1,
  setGuardSuccess = 2,
}
