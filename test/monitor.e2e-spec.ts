import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { NetworkDto } from '../src/common/dto/network.dto';
import { MonitorService } from '../src/modules/monitor/monitor.service';
import {
  createTestContext,
  dealERC20,
  destroyTestContext,
  getRpcUrl,
  TestContext,
} from './utils/context';
import { User } from '../src/modules/user/entities/user.entity';
import { UserDeployment } from '../src/modules/user/entities/user-deployment.entity';
import { parse as uuidParse } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('Monitor Service (e2e)', () => {
  let context: TestContext;
  let monitorService: MonitorService;

  beforeEach(async () => {
    context = await createTestContext();
    monitorService = context.app.get(MonitorService);
  });

  afterEach(async () => {
    await destroyTestContext(context);
  });

  it('Evaluate user precheck by address should success', async () => {
    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerPrivateKey);

    const network = NetworkDto.Bsc;
    const rpcUrl = getRpcUrl(context, network);
    const deploymentConfig =
      await context.agentClient.deploymentConfig(network);
    const userInfo = await context.agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner,
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
      1000n * 10n ** 18n,
    );

    const precheckResult = await monitorService.evaluateUserPrecheckByAddress(
      deploymentInfo.address,
      network,
    );
    console.log(JSON.stringify(precheckResult, null, 2));
  });

  it('Trigger rebalance should success', async () => {
    const ownerPrivateKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerPrivateKey);

    const network = NetworkDto.Bsc;
    const rpcUrl = getRpcUrl(context, network);
    const deploymentConfig =
      await context.agentClient.deploymentConfig(network);
    const userInfo = await context.agentClient.registerUserWithOwner(
      network,
      deploymentConfig,
      owner,
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
      1000n * 10n ** 18n,
    );

    const userRepository = context.app.get(getRepositoryToken(User));
    const user = await userRepository.findOne({
      where: {
        id: Buffer.from(uuidParse(userInfo.id as string)),
      },
    });
    if (!user) {
      throw new Error('User not found');
    }

    const deploymentRepository = context.app.get(
      getRepositoryToken(UserDeployment),
    );
    const deployment = await deploymentRepository.findOne({
      where: {
        id: Buffer.from(uuidParse(deploymentInfo.id as string)),
      },
    });
    if (!deployment) {
      throw new Error('Deployment not found');
    }

    const precheckResult = await monitorService.checkUserPositions(
      user,
      deployment,
    );
    console.log(JSON.stringify(precheckResult, null, 2));
    const newUserPortfolio = await context.agentClient.getUserPortfolio(
      network,
      deploymentInfo.address,
    );
    console.log(JSON.stringify(newUserPortfolio, null, 2));
  });
});
