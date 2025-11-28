import {
  createTransport,
  ExecutionRevertedError,
  TransactionRejectedRpcError,
  Transport,
  UserRejectedRequestError,
} from 'viem';
import { OnResponseFn } from 'viem/_types/clients/transports/fallback';

export type FallbackTransport<
  transports extends readonly Transport[] = readonly Transport[],
> = Transport<
  'custom-fallback',
  {
    onResponse: (fn: OnResponseFn) => void;
    transports: {
      [key in keyof transports]: ReturnType<transports[key]>;
    };
  }
>;

export function fallback<const transports extends readonly Transport[]>(
  transports_: transports,
): FallbackTransport<transports> {
  return (({ chain, timeout, ...rest }) => {
    const transports = transports_;
    const key = 'custom-fallback';
    const name = 'Custom-Fallback';

    let onResponse: OnResponseFn = () => {};

    const transport = createTransport(
      {
        key,
        name,
        async request({ method, params }) {
          let includes: boolean | undefined;

          const fetch = async (i = 0): Promise<any> => {
            const transport = transports[i]({
              ...rest,
              chain,
              retryCount: 0,
              timeout,
            });
            try {
              const response = await transport.request({
                method,
                params,
              } as any);

              onResponse({
                method,
                params: params as unknown[],
                response,
                transport,
                status: 'success',
              });

              return response;
            } catch (err) {
              onResponse({
                error: err as Error,
                method,
                params: params as unknown[],
                transport,
                status: 'error',
              });

              if (shouldThrow(err as Error)) throw err;

              // If we've reached the end of the fallbacks, throw the error.
              if (i === transports.length - 1) throw err;

              // Check if at least one other transport includes the method
              includes ??= transports.slice(i + 1).some((transport) => {
                const { include, exclude } =
                  transport({ chain }).config.methods || {};
                if (include) return include.includes(method);
                if (exclude) return !exclude.includes(method);
                return true;
              });
              if (!includes) throw err;

              // Otherwise, try the next fallback.
              return fetch(i + 1);
            }
          };
          return fetch();
        },
        type: 'custom-fallback',
      },
      {
        onResponse: (fn: OnResponseFn) => (onResponse = fn),
        transports: transports.map((fn) => fn({ chain, retryCount: 0 })),
      },
    );

    return transport;
  }) as FallbackTransport<transports>;
}

export function shouldThrow(error: Error) {
  if ('code' in error && typeof error.code === 'number') {
    if (
      error.code === TransactionRejectedRpcError.code ||
      error.code === UserRejectedRequestError.code ||
      ExecutionRevertedError.nodeMessage.test(error.message) ||
      error.code === 5000
    )
      return true;
  }
  return false;
}
