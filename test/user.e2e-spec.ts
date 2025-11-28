import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { initApp } from '../src/app.init';
import { NetworkDto } from '../src/common/dto/network.dto';
import { UserModule } from '../src/user/user.module';
import { AgentClient } from './agent-client';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { DeploymentModule } from '../src/deployment/deployment.module';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { AppModule } from '../src/app.module';
import * as assert from 'assert';
import { UserDeploymentStatusDto } from '../src/user/dto/user.response.dto';
import { DataSource } from 'typeorm';

describe('UserController (e2e)', () => {
  let app: INestApplication;
  let databaseContainer: StartedMySqlContainer;
  let agentClient: AgentClient;
  const bscRpcUrl: string = 'http://127.0.0.1:8545';
  const baseRpcUrl: string = 'http://127.0.0.1:8546';
  const trackerUrl: string = 'http://65.21.45.43:3511';

  before(() => {
    process.env.BSC_RPC_URLS = bscRpcUrl;
    process.env.BASE_RPC_URLS = baseRpcUrl;
    process.env.TRACKER_URL = trackerUrl;
  });

  beforeEach(async () => {
    databaseContainer = await new MySqlContainer('mysql:8').start();
    const host = databaseContainer.getHost();
    const port = databaseContainer.getMappedPort(3306);
    const username = databaseContainer.getUsername();
    const password = databaseContainer.getUserPassword();
    const database = databaseContainer.getDatabase();

    process.env.DB_HOST = host;
    process.env.DB_PORT = port.toString();
    process.env.DB_USERNAME = username;
    process.env.DB_PASSWORD = password;
    process.env.DB_DATABASE = database;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, UserModule, DeploymentModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    const dataSource = app.get(DataSource);

    if (!dataSource.isInitialized) await dataSource.initialize();

    await dataSource.runMigrations();

    app = initApp(app);

    await app.init();

    agentClient = new AgentClient(app.getHttpServer());
  });

  afterEach(async () => {
    await databaseContainer.stop();
    await app.close();
  });

  it('Register user on Bsc should success', async () => {
    const network = NetworkDto.Bsc;
    const rpcUrl = bscRpcUrl;
    const deploymentConfig = await agentClient.deploymentConfig(network);
    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerPrivateKey);

    const userResponse = await agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner.toLowerCase(),
      ownerPrivateKey,
      rpcUrl,
    );

    assert.ok(userResponse.deployments.length > 0);
    userResponse.deployments.forEach((deployment) => {
      if (deployment.network !== network) {
        assert.equal(deployment.status, UserDeploymentStatusDto.Uninitialized);
      } else {
        assert.equal(
          deployment.status,
          UserDeploymentStatusDto.PendingDeployment,
        );
      }
    });

    const userInfo = await agentClient.getUserInfo(owner);
    assert.deepStrictEqual(userInfo, userResponse);
  });

  it('Get user portfolio on Bsc should success', async () => {
    const network = NetworkDto.Bsc;
    const address = '0x9e2a65a9aea1556ba741b6c35cd55f3f7aadbbb0';

    const portfolio = await agentClient.getUserPortfolio(network, address);
    console.log(JSON.stringify(portfolio, null, 2));
  });
});
