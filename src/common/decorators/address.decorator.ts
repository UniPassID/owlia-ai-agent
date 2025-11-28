import { Transform } from 'class-transformer';
import { getAddress } from 'viem';
import { InvalidParameterException } from '../exceptions/base.exception';

export function Address() {
  return Transform(({ value }) => {
    try {
      return getAddress(value);
    } catch {
      throw new InvalidParameterException(`Invalid address: ${value}`);
    }
  });
}

export function AddressArray() {
  return Transform(({ value }) => {
    try {
      return value.map((item) => {
        return getAddress(item);
      });
    } catch {
      throw new InvalidParameterException(`Invalid address array: ${value}`);
    }
  });
}
