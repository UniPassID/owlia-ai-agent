import { ValidatorTypeDto } from '../../modules/deployment/dto/deployment.response.dto';
import { ResponseCodeDto, ResponseDto } from '../dto/response.dto';
import { NetworkDto } from '../dto/network.dto';

export class BaseException extends Error {
  public readonly code: ResponseCodeDto;

  constructor(code: ResponseCodeDto, message: string) {
    super(message);
    this.code = code;
  }

  toResponseDto(): ResponseDto<null> {
    return {
      code: this.code,
      message: this.message,
      data: null,
    };
  }
}

export class UnknownException extends BaseException {
  constructor() {
    super(ResponseCodeDto.UnknownError, 'Unknown error');
  }
}

export class NetworkNotSupportedException extends BaseException {
  constructor(network: NetworkDto) {
    super(
      ResponseCodeDto.NetworkNotSupported,
      `Network ${network} not supported`,
    );
  }
}

export class InvalidSignatureException extends BaseException {
  constructor() {
    super(ResponseCodeDto.InvalidSignature, 'Invalid signature');
  }
}

export class UserAlreadyRegisteredException extends BaseException {
  constructor(owner: string) {
    super(
      ResponseCodeDto.UserAlreadyRegistered,
      `User already registered for owner: ${owner}`,
    );
  }
}

export class ValidatorNotSupportedException extends BaseException {
  constructor(network: NetworkDto, validatorType: ValidatorTypeDto) {
    super(
      ResponseCodeDto.ValidatorNotSupported,
      `Validator ${validatorType} is not supported on network ${network}`,
    );
  }
}

export class PoolNotSupportedException extends BaseException {
  constructor(network: NetworkDto, poolAddress: string) {
    super(
      ResponseCodeDto.PoolNotSupported,
      `Pool ${poolAddress} is not supported on network ${network}`,
    );
  }
}

export class AssetNotSupportedException extends BaseException {
  constructor(network: NetworkDto, asset: string) {
    super(
      ResponseCodeDto.AssetNotSupported,
      `Asset ${asset} is not supported on network ${network}`,
    );
  }
}

export class VaultNotSupportedException extends BaseException {
  constructor(network: NetworkDto, vault: string) {
    super(
      ResponseCodeDto.VaultNotSupported,
      `Vault ${vault} is not supported on network ${network}`,
    );
  }
}

export class UserNotFoundException extends BaseException {
  constructor(network: NetworkDto, address: string) {
    super(
      ResponseCodeDto.UserNotFound,
      `User not found for address: ${address} on network ${network}`,
    );
  }
}

export class InvalidParameterException extends BaseException {
  constructor(message: string) {
    super(ResponseCodeDto.InvalidParameter, message);
  }
}
