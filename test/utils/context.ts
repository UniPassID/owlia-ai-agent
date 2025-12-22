import { INestApplication } from '@nestjs/common';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { AgentClient } from './agent-client';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { initApp } from '../../src/app.init';
import { NetworkDto } from '../../src/common/dto/network.dto';
import axios from 'axios';
import { pad, toHex } from 'viem';

export type TestContext = {
  app: INestApplication;
  databaseContainer: StartedMySqlContainer;
  agentClient: AgentClient;
  baseRpcUrl: string;
};

export async function createTestContext(): Promise<TestContext> {
  const databaseContainer = await new MySqlContainer('mysql:8').start();
  const host = databaseContainer.getHost();
  const port = databaseContainer.getMappedPort(3306);
  const username = databaseContainer.getUsername();
  const password = databaseContainer.getUserPassword();
  const database = databaseContainer.getDatabase();

  const baseRpcUrl: string = 'http://127.0.0.1:8546';
  // const trackerRpcUrl: string = 'http://127.0.0.1:3000';

  process.env.BASE_RPC_URLS = baseRpcUrl;
  // process.env.TRACKER_URL = trackerRpcUrl;

  process.env.DB_HOST = host;
  process.env.DB_PORT = port.toString();
  process.env.DB_USERNAME = username;
  process.env.DB_PASSWORD = password;
  process.env.DB_DATABASE = database;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  let app = moduleFixture.createNestApplication();

  const dataSource = app.get(DataSource);

  if (!dataSource.isInitialized) await dataSource.initialize();

  await dataSource.runMigrations();

  app = initApp(app);

  await app.init();

  const agentClient = new AgentClient(app.getHttpServer());

  return {
    app,
    databaseContainer,
    agentClient,
    baseRpcUrl,
  };
}

export async function destroyTestContext(context: TestContext): Promise<void> {
  if (context) {
    await context.databaseContainer.stop();
    await context.app.close();
  }
}

export function getRpcUrl(context: TestContext, network: NetworkDto): string {
  switch (network) {
    case NetworkDto.Base:
      return context.baseRpcUrl;
  }
}

export async function dealERC20(
  rpcUrl: string,
  userAddress: string,
  tokenAddress: string,
  amount: bigint,
): Promise<void> {
  const response = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    method: 'anvil_dealERC20',
    params: [userAddress, tokenAddress, pad(toHex(amount), { size: 32 })],
    id: 1,
  });
  if (response.data.error) {
    throw new Error(`Failed to deal ERC20: ${response.data.error.message}`);
  }
}
