import type {ReactNode} from 'react';
import React, {useContext, useEffect, useMemo} from 'react';
import {createContext} from 'react';

import useSWR from 'swr';

export class IDBError extends Error {
  constructor(
    message: string,
    public readonly original?: Error,
  ) {
    super(message);
  }
}

export class IDBNotSupportedError extends Error {
  constructor(
    message: string,
    public readonly original?: Error,
  ) {
    super(message);
  }
}

type Ctx = {db: IDBDatabase; error: undefined} | {db: undefined; error: IDBError};

const IndexedDbContext = createContext<Ctx>(null as any as Ctx);

function getStorage(name: string, version: number, onUpgradedNeeded: (db: IDBDatabase) => void) {
  const req = indexedDB.open(name, version);

  return new Promise<IDBDatabase>((resolve, reject) => {
    req.onupgradeneeded = function (this: IDBRequest<IDBDatabase>) {
      onUpgradedNeeded(this.result);
    };

    req.onsuccess = function (this: IDBRequest<IDBDatabase>) {
      resolve(this.result);
    };
    req.onerror = function (this: IDBRequest<IDBDatabase>) {
      reject(
        this.error ? new IDBError('Failed to open indexedDB', this.error) : new IDBError('Failed to open indexedDB due to unknown error'),
      );
    };
  });
}

export function IndexedDbProvider(props: {
  name: string;
  version: number;
  loading: ReactNode;
  onUpgradedNeeded: (db: IDBDatabase) => void;
  children: ReactNode;
}) {
  const {name, version, loading, onUpgradedNeeded, children} = props;
  const {data, mutate, error, isLoading} = useSWR('idb', () => getStorage(name, version, onUpgradedNeeded), {
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    revalidateOnReconnect: false,
  });

  useEffect(
    () => () => {
      if (data == null) {
        return;
      }
      data.close();
      void mutate(undefined);
    },
    [],
  );

  return (
    <IndexedDbContext.Provider value={{db: data, error} as any}>
      {data === undefined ? loading : isLoading ? loading : children}
    </IndexedDbContext.Provider>
  );
}

export function useIndexedDB() {
  const {db, error} = useContext(IndexedDbContext);
  if (error) {
    throw error;
  }
  return db;
}

export function functionalityCheckHookFactory(storeName: string) {
  return function useAssertIDBFullySupported() {
    const db = useIndexedDB();
    return useMemo(() => {
      const txn = db.transaction(storeName, 'readwrite').objectStore(storeName);
      try {
        txn.put({id: 'browser-compatibility-check', v: new Blob()});
      } catch (error) {
        if (error instanceof Error && error.name === 'DataCloneError') {
          // https://bugs.webkit.org/show_bug.cgi?id=198278
          // Safari 12でFIXされたことになっているけど現代でも再現する。req.onerrorをすっ飛ばして普通にexceptionを飛ばすので注意
          // この挙動は放置されているだけで、ただのSafariのバグである。このロジックにプライバシーモード検出用としての信頼性はない
          throw new IDBNotSupportedError(
            'ブラウザがバイナリデータの保存に対応していません。プライベートモードで起動していないことを確認してください',
            error,
          );
        }
        throw new IDBError(
          'ブラウザがバイナリデータの保存に対応していません。プライベートモードでアクセスを試みている可能性があります',
          error as Error,
        );
      }
    }, []);
  };
}

/**
 * React関係ないただのヘルパ
 */
export function requestAsPromise<Content>(
  req: IDBRequest<Content>,
  opts?: {
    msgOnError: string;
  },
): Promise<Content> {
  return new Promise((resolve, reject) => {
    req.onsuccess = function (this: IDBRequest<Content>) {
      resolve(this.result);
    };
    req.onerror = function (this: IDBRequest<Content>) {
      reject(
        this.error
          ? new IDBError(opts?.msgOnError ?? 'Failed to exec operation', this.error)
          : new IDBError(opts?.msgOnError ?? 'Failed to exec operation due to unknown error'),
      );
    };
  });
}
