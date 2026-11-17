// One network provider made of several Electrum servers. Reads (UTXOs, tip height, history, confirmations) try the server that
// answered last, then the others, so one server being down no longer breaks every pact page. A broadcast is NOT retried on another
// server: it goes to the server that last answered, and a rejection stays a rejection. Servers only supply what the screen shows;
// the contracts and the signatures still decide where the money can go.
export function failoverProvider(providers, { timeoutMs = 12000 } = {}) {
  if (!providers.length) throw new Error('at least one provider is required');
  let cur = 0;
  const timed = (p) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error('The network did not answer in time.')), timeoutMs))]);
  async function read(call) {
    let last;
    for (let k = 0; k < providers.length; k += 1) {
      const i = (cur + k) % providers.length;
      try { const r = await timed(call(providers[i])); cur = i; return r; } catch (e) { last = e; }
    }
    throw last;
  }
  return {
    network: providers[0].network,
    getUtxos: (address) => read((p) => p.getUtxos(address)),
    getBlockHeight: () => read((p) => p.getBlockHeight()),
    performRequest: (...args) => read((p) => p.performRequest(...args)),
    sendRawTransaction: (hex) => providers[cur].sendRawTransaction(hex),
    get current() { return cur; },
  };
}
