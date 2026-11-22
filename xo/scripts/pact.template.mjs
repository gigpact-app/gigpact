// GigPact pact vault as an XO template (spike). Three spend paths of GigPact's accepted stage, in plain BCH script:
//  pay    (0): organizer signs, output 0 must go to the worker payout lock
//  waive  (1): worker signs,    output 0 must go to the organizer refund lock
//  claim  (2): worker signs after block tEnd (CLTV), output 0 must go to the worker payout lock
const R = { organizer: 'organizer', worker: 'worker' };
const two = (a) => ({ role: a, slots: { min: 1, max: 1 } });
export const pactTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: 'GigPact pact (accepted stage)',
  description: 'Locks the gig fee. The organizer can only pay the worker, the worker can only waive back to the organizer, and after the event end the worker can always claim the fee.',
  icon: 'vault',
  version: '1',
  supported: ['BCH_2023_05', 'BCH_2024_05', 'BCH_2025_05', 'BCH_2026_05'],
  defaults: {
    change: { output: 'changeOutput', role: 'organizer' },
    address: { lockingScript: 'pactLockingScript', role: 'organizer' },
    receive: { output: 'fundOutput', role: 'organizer' },
  },
  roles: {
    organizer: { name: 'Organizer', description: 'Pays the worker after the gig.', icon: 'signer' },
    worker: { name: 'Worker', description: 'Is paid for the gig and can claim after the event end.', icon: 'signer' },
  },
  start: [{ action: 'fund', role: 'organizer', generate: ['organizerKey'] }],
  actions: {
    fund: {
      name: 'Fund the pact',
      description: 'The organizer and the worker each give their public key; the fee is locked in the pact script.',
      icon: 'receive',
      roles: {
        organizer: { name: 'Fund', description: 'Generate the organizer key and lock the fee.', icon: 'signer', generate: ['organizerKey'], requirements: { variables: ['organizerPublicKey'] } },
        worker: { name: 'Accept', description: 'Generate the worker key.', icon: 'signer', generate: ['workerKey'], requirements: { variables: ['workerPublicKey'] } },
      },
      requirements: { variables: ['fundedSatoshis', 'payoutLockingScript', 'refundLockingScript', 'eventEndBlock'], participants: [two('organizer'), two('worker')] },
      transaction: 'fundTransaction',
    },
    pay: {
      name: 'Pay the worker',
      description: 'The organizer releases the fee to the worker payout address.',
      icon: 'send',
      roles: { organizer: { requirements: { secrets: ['organizerKey'] } } },
      requirements: { variables: [], participants: [two('organizer')] },
      transaction: 'payTransaction',
    },
    waive: {
      name: 'Waive the fee',
      description: 'The worker gives the fee back to the organizer refund address.',
      icon: 'send',
      roles: { worker: { requirements: { secrets: ['workerKey'] } } },
      requirements: { variables: [], participants: [two('worker')] },
      transaction: 'waiveTransaction',
    },
    claim: {
      name: 'Claim after the event',
      description: 'After the event end block the worker can always take the fee to the payout address.',
      icon: 'send',
      roles: { worker: { requirements: { secrets: ['workerKey'] } } },
      requirements: { variables: [], participants: [two('worker')] },
      transaction: 'claimTransaction',
    },
  },
  transactions: {
    fundTransaction: { name: 'Pact funded', description: '$(<fundedSatoshis>) satoshis were locked in the pact.', icon: 'receive', inputs: [], outputs: [{ output: 'fundOutput', outputIndex: undefined }], version: 2, locktime: 0, composable: true },
    payTransaction: { name: 'Worker paid', description: 'The organizer paid the worker.', icon: 'send', inputs: [{ input: 'payInput', inputIndex: undefined }], outputs: [{ output: 'toWorkerOutput', outputIndex: undefined }], version: 2, locktime: 0, composable: true },
    waiveTransaction: { name: 'Fee waived', description: 'The worker gave the fee back to the organizer.', icon: 'send', inputs: [{ input: 'waiveInput', inputIndex: undefined }], outputs: [{ output: 'toOrganizerOutput', outputIndex: undefined }], version: 2, locktime: 0, composable: true },
    claimTransaction: { name: 'Fee claimed', description: 'The worker claimed the fee after the event end.', icon: 'send', inputs: [{ input: 'claimInput', inputIndex: undefined }], outputs: [{ output: 'toWorkerOutput', outputIndex: undefined }], version: 2, locktime: '$(<eventEndBlock>)', composable: true },
  },
  outputs: {
    changeOutput: { name: 'Change', description: 'Returned to the pact.', icon: 'receive', lockingScript: 'pactLockingScript' },
    fundOutput: { name: 'Pact output', description: 'The fee locked in the pact.', icon: 'receive', lockingScript: 'pactLockingScript', valueSatoshis: '$(<fundedSatoshis>)', token: null },
    toWorkerOutput: { name: 'Worker payout', description: 'The fee paid to the worker.', icon: 'send', lockingScript: '$(<payoutLockingScript>)' },
    toOrganizerOutput: { name: 'Organizer refund', description: 'The fee returned to the organizer.', icon: 'send', lockingScript: '$(<refundLockingScript>)' },
  },
  inputs: {
    payInput: { name: 'Pact spend (pay)', description: 'Organizer pays the worker.', icon: 'send', unlockingScript: 'unlockPay' },
    waiveInput: { name: 'Pact spend (waive)', description: 'Worker waives.', icon: 'send', unlockingScript: 'unlockWaive' },
    claimInput: { name: 'Pact spend (claim)', description: 'Worker claims after the event end.', icon: 'send', unlockingScript: 'unlockClaim' },
  },
  lockingScripts: {
    pactLockingScript: {
      name: 'GigPact pact', description: 'The fee waits here until it is paid, waived or claimed.', icon: 'vault',
      lockingType: 'p2sh', lockingBytecode: 'pactRedeemScript',
      state: { variables: ['organizerPublicKey', 'workerPublicKey', 'payoutLockingScript', 'refundLockingScript', 'eventEndBlock'] },
      actions: [],
      roles: {
        organizer: { state: { secrets: ['organizerKey'] }, actions: [{ action: 'pay', role: 'organizer', secrets: [{ organizerKey: null }] }], balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true },
        worker: { state: { secrets: ['workerKey'] }, actions: [{ action: 'waive', role: 'worker', secrets: [{ workerKey: null }] }, { action: 'claim', role: 'worker', secrets: [{ workerKey: null }] }], balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true },
      },
    },
  },
  scripts: {
    unlockPay: '<organizerKey.schnorr_signature.all_outputs> OP_0',
    unlockWaive: '<workerKey.schnorr_signature.all_outputs> OP_1',
    unlockClaim: '<workerKey.schnorr_signature.all_outputs> OP_2',
    pactRedeemScript:
      'OP_DUP OP_0 OP_NUMEQUAL OP_IF OP_DROP OP_0 OP_OUTPUTBYTECODE <payoutLockingScript> OP_EQUALVERIFY <organizerPublicKey> OP_CHECKSIG ' +
      'OP_ELSE OP_1 OP_NUMEQUAL OP_IF OP_0 OP_OUTPUTBYTECODE <refundLockingScript> OP_EQUALVERIFY <workerPublicKey> OP_CHECKSIG ' +
      'OP_ELSE <eventEndBlock> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_0 OP_OUTPUTBYTECODE <payoutLockingScript> OP_EQUALVERIFY <workerPublicKey> OP_CHECKSIG OP_ENDIF OP_ENDIF',
  },
  constants: {},
  variables: {
    organizerKey: { name: 'Organizer Key', description: 'Private key of the organizer.', type: 'private_key' },
    workerKey: { name: 'Worker Key', description: 'Private key of the worker.', type: 'private_key' },
    organizerPublicKey: { name: 'Organizer Public Key', description: 'Public key of the organizer.', type: 'public_key' },
    workerPublicKey: { name: 'Worker Public Key', description: 'Public key of the worker.', type: 'public_key' },
    payoutLockingScript: { name: 'Worker payout', description: 'Locking script that receives the fee when it is paid or claimed.', type: 'locking_script' },
    refundLockingScript: { name: 'Organizer refund', description: 'Locking script that receives the fee when it is waived.', type: 'locking_script' },
    fundedSatoshis: { name: 'Fee', description: 'The locked fee in satoshis.', type: 'satoshis' },
    eventEndBlock: { name: 'Event end block', description: 'Block height after which the worker can claim.', type: 'integer' },
  },
  icons: [{ name: 'vault', hash: '0000000000000000000000' }, { name: 'signer', hash: '0000000000000000000000' }, { name: 'receive', hash: '0000000000000000000000' }, { name: 'send', hash: '0000000000000000000000' }],
};
