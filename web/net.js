// Network access (Electrum over WebSocket via CashScript's provider). Read-only here: tip height and UTXOs.
import { ElectrumNetworkProvider } from 'cashscript';
import { NET } from './config.js';
export const provider = new ElectrumNetworkProvider(NET);
const withTimeout = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('The network did not answer in time.')), ms))]);
export const tip = () => withTimeout(provider.getBlockHeight());
export const utxosAt = (address) => withTimeout(provider.getUtxos(address));
