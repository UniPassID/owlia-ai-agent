import { Injectable } from '@nestjs/common';
import { lookupTokenAddress } from '../../agent/token-utils';
import {
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
} from '../../agent/types/mcp.types';
import { Opportunity } from './types';
import { APYCalculatorService } from './apy-calculator.service';

@Injectable()
export class OpportunityConverterService {
  constructor(private readonly apyCalculator: APYCalculatorService) {}

  /**
   * Convert raw opportunities to Opportunity objects with APY functions
   */
  convertToOpportunities(
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    totalCapital: number,
    chainId: string,
    dexPools: Record<string, any>,
  ): Opportunity[] {
    const opportunities: Opportunity[] = [];

    // Convert supply opportunities
    for (const data of supplyData) {
      if (!data.opportunities || !Array.isArray(data.opportunities)) continue;

      for (const opp of data.opportunities) {
        const asset = opp.asset || '';
        const tokenAddress = lookupTokenAddress(asset, chainId);
        const apyFunctions = this.apyCalculator.createSupplyAPYFunctions(
          opp,
          totalCapital,
          chainId,
        );

        opportunities.push({
          id: `supply-${opp.protocol}-${asset}`,
          type: 'supply',
          targetTokens: tokenAddress ? [tokenAddress] : [asset],
          getAPY: apyFunctions.syncFn,
          getAPYAsync: apyFunctions.asyncFn,
          maxAmount: totalCapital * 10,
          protocol: this.normalizeProtocolName(opp.protocol || 'aave'),
          chainId,
          asset,
          vaultAddress: opp.vault_address,
        });
      }
    }

    // Convert LP opportunities
    for (const sim of lpSimulations) {
      const poolAddress = sim.pool?.poolAddress || '';
      if (!poolAddress) continue;

      const token0Address = this.extractTokenAddress(
        poolAddress,
        dexPools,
        'token0',
      );
      const token1Address = this.extractTokenAddress(
        poolAddress,
        dexPools,
        'token1',
      );
      const targetTokens = [token0Address, token1Address].filter((t) => t);
      const apyFunctions = this.apyCalculator.createLpAPYFunctions(
        sim,
        totalCapital,
        chainId,
      );

      opportunities.push({
        id: `lp-${poolAddress}`,
        type: 'lp',
        targetTokens,
        getAPY: apyFunctions.syncFn,
        getAPYAsync: apyFunctions.asyncFn,
        maxAmount: totalCapital * 10,
        protocol: this.extractLpProtocol(poolAddress, dexPools),
        chainId,
        currentTick: sim.pool?.position?.currentTick,
        poolAddress,
        token0Address,
        token1Address,
        tickLower: sim.pool?.position?.tickLower,
        tickUpper: sim.pool?.position?.tickUpper,
      });
    }

    return opportunities;
  }

  private extractTokenAddress(
    poolAddress: string,
    dexPools: Record<string, any>,
    tokenKey: 'token0' | 'token1',
  ): string {
    const normalizedPoolAddress = poolAddress.toLowerCase();

    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr.toLowerCase() === normalizedPoolAddress) {
        const currentSnapshot = poolData?.currentSnapshot || {};
        return (
          currentSnapshot[`${tokenKey}Address`] ||
          currentSnapshot[tokenKey] ||
          ''
        );
      }
    }
    return '';
  }

  private extractLpProtocol(
    poolAddress: string,
    dexPools: Record<string, any>,
  ): string {
    if (!poolAddress || !dexPools) return 'aerodromeSlipstream';

    const normalizedPoolAddress = poolAddress.toLowerCase();

    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr === '_dataSource') continue;
      if (poolAddr.toLowerCase() === normalizedPoolAddress) {
        const dexKey = poolData?.currentSnapshot?.dexKey;
        if (dexKey) return this.normalizeProtocolName(dexKey);

        const protocol = poolData?.protocol || poolData?.dex || poolData?.type;
        if (protocol) return this.normalizeProtocolName(protocol);
        break;
      }
    }
    return 'aerodromeSlipstream';
  }

  private normalizeProtocolName(protocol: string): string {
    const protocolMap: Record<string, string> = {
      aerodromecl: 'aerodromeSlipstream',
      aerodrome: 'aerodromeSlipstream',
      uniswapv3: 'uniswapV3',
      aave: 'aave',
      euler: 'euler',
      venus: 'venus',
    };
    return protocolMap[protocol.toLowerCase()] || protocol;
  }
}
