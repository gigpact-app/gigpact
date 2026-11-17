// Network access (Electrum over WebSocket via CashScript's provider). Read-only here: tip height and UTXOs; the broadcast goes
// through the same object. Mainnet uses two public Electrum servers with failover (see failover.js).
import { ElectrumNetworkProvider } from 'cashscript';
import { NET } from './config.js';
import { failoverProvider } from './failover.js';
const HOSTS = NET === 'mainnet' ? ['bch.imaginary.cash', 'bitcoincash.network'] : [null];
export const provider = failoverProvider(HOSTS.map((hostname) => new ElectrumNetworkProvider(NET, hostname ? { hostname } : {})));
export const tip = () => provider.getBlockHeight();
export const utxosAt = (address) => provider.getUtxos(address);
