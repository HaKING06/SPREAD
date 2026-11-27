# Changelog

## 11.4.0 - 2026-11-27

- Rank single strategies using an adverse two-leg price scenario, including whole-unit exit sizing and a cash reserve.
- Treat missing cash market bids as unknown instead of substituting asking prices.

## 11.3.0 - 2026-11-27

- Use the current Steam lowest listing for purchase sizing when histogram quotes are unavailable.
- Include estimated acquisition slippage in the single-strategy budget check.

## 11.2.1 - 2026-11-27

- Restored the previous page template to fix duplicate controls and broken markup.

## 11.2.0 - 2026-11-27

- Instant cashout calculations require a buy order for the selected cash marketplace.
- Recent Steam order-book asks take precedence over historical reference prices for Steam purchases.
- On-demand Steam verification expires and is preserved across bulk market refreshes.
- Half-Kelly sizing uses simulated gains and losses plus a capital-loss stress observation and can recommend zero allocation.
- Fixed duplicate and malformed markup and aligned the public release and package versions.
