import { NetworkDto } from '../src/common/dto/network.dto';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import * as assert from 'assert';
import { UserDeploymentStatusDto } from '../src/modules/user/dto/user.response.dto';
import {
  createTestContext,
  dealERC20,
  destroyTestContext,
  getRpcUrl,
  TestContext,
} from './utils/context';

describe('UserController (e2e)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await destroyTestContext(context);
  });

  it('Register user on Base should success', async () => {
    const network = NetworkDto.Base;
    const rpcUrl = context.baseRpcUrl;
    const deploymentConfigs = await context.agentClient.deploymentConfigs();
    const deploymentConfig = deploymentConfigs.configs.find(
      (config) => config.network === network,
    );
    if (!deploymentConfig) {
      throw new Error('Deployment config not found');
    }
    const ownerPrivateKey = generatePrivateKey();
    console.log('ownerPrivateKey', ownerPrivateKey);
    const owner = privateKeyToAddress(ownerPrivateKey);

    const userResponse = await context.agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner.toLowerCase(),
      ownerPrivateKey,
      rpcUrl,
    );
    console.log('userResponse', userResponse);

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

    const userInfo = await context.agentClient.getUserInfo(owner);
    assert.deepStrictEqual(userInfo, userResponse);
  });

  it('Get user portfolio on Base should success', async () => {
    const network = NetworkDto.Base;
    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerPrivateKey);
    const rpcUrl = getRpcUrl(context, network);
    const deploymentConfigs = await context.agentClient.deploymentConfigs();
    const deploymentConfig = deploymentConfigs.configs.find(
      (config) => config.network === network,
    );
    if (!deploymentConfig) {
      throw new Error('Deployment config not found');
    }
    const userInfo = await context.agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner.toLowerCase(),
      ownerPrivateKey,
      rpcUrl,
    );
    const deploymentInfo = userInfo.deployments.find(
      (deployment) => deployment.network === network,
    );
    if (!deploymentInfo) {
      throw new Error('Deployment not found');
    }

    await dealERC20(
      rpcUrl,
      deploymentInfo.address,
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      1000000000000000000n,
    );

    const portfolio = await context.agentClient.getUserPortfolio(
      network,
      deploymentInfo.address,
    );
    console.log(JSON.stringify(portfolio, null, 2));
  });

  it('Get user portfolios on Base should success', async () => {
    const network = NetworkDto.Base;
    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerPrivateKey);
    const rpcUrl = getRpcUrl(context, network);
    const deploymentConfigs = await context.agentClient.deploymentConfigs();
    const deploymentConfig = deploymentConfigs.configs.find(
      (config) => config.network === network,
    );
    if (!deploymentConfig) {
      throw new Error('Deployment config not found');
    }
    const userInfo = await context.agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner.toLowerCase(),
      ownerPrivateKey,
      rpcUrl,
    );
    const deploymentInfo = userInfo.deployments.find(
      (deployment) => deployment.network === network,
    );
    if (!deploymentInfo) {
      throw new Error('Deployment not found');
    }
    const limit = 10;
    const portfolios = await context.agentClient.getUserPortfolios(
      network,
      deploymentInfo.address,
      [],
      limit,
    );
    console.log(JSON.stringify(portfolios, null, 2));
  });
});
