I built the GigPact pact as an XO template: an accepted-stage pact with organizer and worker roles, fund / pay / waive / claim actions, and one P2SH32 pact with three spending paths. I also wrote an offline libauth VM test for those paths.

On mainnet I funded and paid the pact from Node with @xo-cash/engine 0.1.1-next.18230317763 (fund 8f086a94c945d495fa4bff410aae17c063fe5ef10eb6662da0f0b38e18a199f2, pay c6bf29f0828ce9c5e4a6300151c4baecde48c25f099c57681b5e87d812f68058). I also funded it once from the blaze.xo.cash debug tool (166bc7eeac142eed4087003d6d124fff2882cc814d711e41336a620cea5e68f1).

What worked best: the Node flow ran end to end once I used one terminal per role, because two engines in one process failed. In the browser tool, the transaction inspector and the script debugger (43/43 steps, SUCCESS on the pay transaction) made it easy to check what I had built.

The biggest problem was change. The template's default change output pointed at the pact locking script. In Node I got around it by adding my own P2PKH change output. In the browser I could not redirect it, so I published without change and paid a 3000 sat fee. I think the template defaults cause this, but I have not confirmed it with the XO team.

Smaller things: "Create change address" showed a blank screen until I set the default policies in Settings, Join Invitation said "Template not found" until I imported the template on the second account, and IntentVariablesMissingError was not clear about which variable was needed at which step.

What the browser tool did not do for me: the pact output never showed up in Assets ("No holdings yet"), so I could not start the pay action from there. I only checked the organizer account, and I did not try Builder or Primitives.

One thing I would change: let me choose where the change output goes in the browser tool, and list pact outputs under Assets.

Not tested on chain: waive and claim. I only tested those two in the offline VM.
