import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { initApp } from '../src/app.init';
import { NetworkDto } from '../src/user/dto/common.dto';
import { UserModule } from '../src/user/user.module';
import { AgentClient } from './agent-client';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { DeploymentModule } from '../src/deployment/deployment.module';
import blockchainsConfig from '../src/config/blockchains.config';
import { DataSource } from 'typeorm';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { AppModule } from '../src/app.module';
import * as assert from 'assert';
import { UserDeploymentStatusDto } from '../src/user/dto/user.response.dto';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let databaseContainer: StartedMySqlContainer;
  let agentClient: AgentClient;
  const bscRpcUrl: string = 'http://127.0.0.1:8545';
  const baseRpcUrl: string = 'http://127.0.0.1:8546';

  beforeEach(async () => {
    databaseContainer = await new MySqlContainer('mysql:8').start();
    const host = databaseContainer.getHost();
    const port = databaseContainer.getMappedPort(3306);
    const username = databaseContainer.getUsername();
    const password = databaseContainer.getUserPassword();
    const database = databaseContainer.getDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            blockchainsConfig,
            () => ({
              database: {
                host,
                port,
                username,
                password,
                database,
              },
              blockchains: {
                bsc: {
                  rpcUrl: bscRpcUrl,
                },
                base: {
                  rpcUrl: baseRpcUrl,
                },
              },
            }),
          ],
        }),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: () => {
            return {
              type: 'mysql',
              host: host,
              port: port,
              username: username,
              password: password,
              database: database,
              entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
              migrations: [__dirname + '/../src/migrations/*.ts'],
              synchronize: true,
              logging: ['error'],
              extra: {
                connectionLimit: 1,
                connectTimeout: 60000,
              },
            };
          },
        }),
        AppModule,
        UserModule,
        DeploymentModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app = initApp(app);

    await app.init();

    const dataSource = app.get<DataSource>(getDataSourceToken());
    await dataSource.runMigrations();
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

    const safe = await agentClient.getSafe(
      deploymentConfig,
      owner,
      ownerPrivateKey,
      rpcUrl,
    );

    const setGuardTx = await agentClient.setGuardTx(safe, deploymentConfig);

    const validatorTxs = agentClient.getValidatorTxs(network, deploymentConfig);

    const transaction = await safe.createTransaction({
      transactions: [setGuardTx, ...validatorTxs],
    });
    const signedTransaction = await safe.signTransaction(transaction);
    const sig = signedTransaction.encodedSignatures();
    const userResponse = await agentClient.registerUser(
      network,
      owner,
      deploymentConfig.validators,
      sig,
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
});
