# Nimgavel — DESIGN.md

Engineer design system. Build from this file alone. No external references required.

## 1. Brand core

- Name: Nimgavel. Tagline: "Going once. Going twice. NIM."
- Feel: dark trading floor, warm gavel. Bloomberg-terminal density with one orange energy source: the auction moment.
- Rules: no gradients, no glow, no glassmorphism, no illustrations beyond the ghost mascot, no placeholder or lorem text anywhere. Every screen shows real data or an honest empty state.

## 2. Design tokens

### Colors (dark only, the app lives in a dark WebView)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0A0C10` | page background |
| `--surface` | `#12151B` | cards, panels, banner |
| `--surface-2` | `#181C24` | nested rows, feed items |
| `--border` | `#1F242D` | 1px hairlines |
| `--text` | `#F2F4F8` | primary text |
| `--text-dim` | `#8B93A1` | secondary text |
| `--orange` | `#FF8A00` | bids, CTAs, brand moments, LIVE badge |
| `--orange-press` | `#D97700` | pressed CTA |
| `--red` | `#FF4D5E` | GOING TWICE urgency, destructive errors |
| `--green` | `#3DD68C` | SOLD stamp, settled receipt, verified tx |

Contrast: `--text` on `--bg` = 16.9:1, `--text-dim` on `--surface` = 4.6:1, `--orange` on `--surface` = 7.1:1. All pass WCAG AA.

### Typography

| Role | Font | Weight | Size (mobile) |
|---|---|---|---|
| Display / current bid / lot title | Space Grotesk | 700 | 24-40px |
| UI body, labels | Inter | 400/500 | 13-15px |
| Feed rows, mono data (paddle, hash, time) | JetBrains Mono | 400 | 12-13px |

Numbers in the bid display and countdown use `font-variant-numeric: tabular-nums` so digits never shift width while ticking. Space Grotesk and Inter load via `@fontsource` self-hosted (no Google Fonts request from the WebView).

### Space, radius, elevation

- 4px base grid. Screen padding 16px. Card padding 16px. Feed row height 40px.
- Radius: 8px cards, 4px buttons and inputs. No radius on full-bleed banners.
- No shadows except the modal scrim (rgba(0,0,0,0.6)) and the gavel slam impact flash. Elevation comes from `--surface` vs `--surface-2` layering, not blur or shadow.

## 3. Layout system

Mobile-first single column, max-width 520px centered (desktop spectate stays centered, never stretches). Fixed height regions inside the Room: banner (36px) / lot block / bid block / CTA (56px, sticky bottom) / feed (flex-1, scroll). Safe-area insets for the WebView: `env(safe-area-inset-bottom)` padding on sticky CTA.

## 4. Logo and icon

Three-Strike Gavel: geometric gavel head at 45 degrees above a strike plate, three impact arcs to the right of the strike point, third arc boldest. SVG, `currentColor` strokes: `#FF8A00` arcs and gavel, `#F2F4F8` plate on dark.

In-app component `GavelArcs` uses only the three arcs as a live phase meter: arc 1 fills on GOING ONCE, arcs 1-2 on GOING TWICE, all three with the slam flash on SOLD. Favicon and app icon: mark only, readable at 16px.

## 5. Component inventory

| Component | Spec |
|---|---|
| `StateBanner` | full-bleed 36px bar, text left, live connection count right. Variant per phase (section 7) |
| `LotCard` (lobby) | `--surface` card: title, thumb 64px, live bid, paddle count or final price, Enter CTA |
| `CurrentBid` | Space Grotesk 40px tabular, orange, amount + NIM suffix; below: leading paddle chip |
| `PaddleChip` | mono 12px chip: `#42 Quiet Otter`. Own paddle gets orange border |
| `CountdownRing` | 56px SVG ring, stroke `--text-dim`, progress orange; switches to `--red` under 15s. Center: mono `m:ss` |
| `BidButton` | sticky bottom 56px, orange fill, dark text, label `BID 43 NIM`. Disabled state: reason inline (min increment, not live, host) |
| `BidFeed` | newest-first list, `--surface-2` rows 40px: `#41 DaringFalcon  41 NIM  12s`. Own rows orange left border 2px. New row slides in 150ms |
| `GavelSlam` | on SOLD: full-screen flash 80ms (orange 8% opacity), gavel mark scales 1.0 to 1.15 and drops, three arcs fill, then SOLD stamp (section 7) |
| `SoldStamp` | bordered `--green` stamp, Space Grotesk 700, slight -8deg rotation, mono sub-line with final price |
| `ReceiptRow` | label left dim, value right mono (tx hash truncated 10+8, explorer link `--orange`) |
| `GhostState` | mascot empty states: 80px ghost SVG with paddle, one line of copy (section 9) |
| `PaySheet` | modal: amount due big, host address truncated, Pay button triggers native wallet tx, Cancel is a first-class outcome |

## 6. Routes and wireframes

### `/` Lobby

```
+-----------------------------+
| [mark] NIMGAVEL             |
| Going once. Going twice.NIM |
+-----------------------------+
| LIVE                        |
| +-------------------------+ |
| | Nimiq builders patch    | |
| | 42 NIM · 3 paddles · 27s| |
| | [ Enter the room ]      | |
| +-------------------------+ |
| NEXT  Sep 9 · Sip & Ship    |
| Host a lot          >      |
+-----------------------------+
| RECENT RESULTS              |
| nimiq.gavel domain  120 NIM |
| Call guest slot      80 NIM |
| (empty: ghost + line)      |
+-----------------------------+
```

Lobby loads `GET /api/lots` (live, upcoming, results). LIVE card polls the REST state endpoint every 5s (no WS in lobby; WS opens only inside a room).

### `/room/:lotId` The Room

```
+-----------------------------+
| GOING ONCE            12 on |
+-----------------------------+
| [ lot image 4:3 ]           |
| Nimiq builders patch        |
| host #7 · lot 12            |
|                             |
|        42 NIM               |
|  leading  #42 QuietOtter    |
|     ( countdown 00:27 )     |
|                             |
+-----------------------------+
| bid feed (scroll)           |
| #41 DaringFalcon 41 · 12s   |
| #40 QuietOtter   40 · 29s   |
| ...                         |
+-----------------------------+
| [ BID 43 NIM ]              |  <- sticky CTA
+-----------------------------+
```

Bid button label always shows the exact next legal amount. Host viewing own room sees CTA replaced by `You are hosting. Watch the room.`

### `/room/:lotId` after SOLD (winner view)

```
+-----------------------------+
| SOLD                        |
+-----------------------------+
| [ SoldStamp over lot ]      |
|        43 NIM               |
|  won by  #42 QuietOtter     |
+-----------------------------+
| YOU WON · PAY 43 NIM        |
| to host NQ..9F2K (trunc)    |
| [ Pay with Nimiq Pay ]      |
+-----------------------------+
| receipt appears after tx    |
| tx 0x9f2e..c1  view block   |
+-----------------------------+
```

Non-winner view after SOLD: stamp, final price, winner paddle, feed intact, no pay block.

### `/host` Create lot

```
+-----------------------------+
| Host a lot                  |
+-----------------------------+
| Title        [ input      ] |
| Description  [ textarea   ] |
| Image URL    [ input      ] |
| Start price  [ 5 NIM ]      |
| Increment    [ 1 NIM ]      |
| Duration     [ 3 min ]      |
| Payout address  (from      ) |
|                 wallet      |
|                             |
| [ Sign & create lot ]       |
+-----------------------------+
```

Fields carry editable default values (5 NIM, 1 NIM, 3 min). Payout address is the connected wallet address, shown, not typed. Create = sign challenge then POST. Host list below the form: my lots with status chips and a Start control for scheduled lots.

### Spectate wrapper (plain browser)

Top bar 28px: `Open this room in Nimiq Pay` with deeplink `https://nimpay.app/miniapps/open/<current-url>`. All write controls hidden.

## 7. Lot phase to UI state table

| Phase | StateBanner | Ring | CTA |
|---|---|---|---|
| live | `LIVE` orange text, `GAVEL IN` when first opened | orange | enabled |
| going_once | `GOING ONCE`, arc 1 lit | orange | enabled |
| going_twice | `GOING TWICE` `--red` bg tint 12% | red, pulse 1s | enabled |
| sold | `SOLD` green text | full green | winner: Pay; others: none |
| passed | `PASSED · no bids` dim | empty dim | none |
| settled | `SETTLED` green + check | full green | receipt link |

Countdown never turns red above 15s. All phase changes arrive as WS messages; the client renders immediately and re-syncs on `state`.

## 8. Wallet and connection states

| State | Trigger | UI |
|---|---|---|
| connecting | SDK init in flight | skeleton Lobby, mono `connecting wallet` |
| ready | accounts listed | normal |
| spectate | no provider (plain browser) | spectate bar, write controls hidden |
| cancelled | user rejects account/device prompt | inline dim copy: `Wallet request cancelled. Tap to retry.` Never a red error |
| reconnecting | WS drop | banner right shows `reconnecting`, backoff, bid button disabled with `waiting for the room` |
| consensus lost | `isConsensusEstablished` false | dim banner line `wallet syncing · payments wait`, bidding still allowed |

## 9. Empty and error states (ghost mascot lines)

| Surface | Copy |
|---|---|
| Lobby, no lots | Ghost holds paddle. `The room is quiet. Host the first lot.` |
| Feed empty at open | `Waiting for the first paddle.` |
| Outbid toast | Ghost deflated, 1.5s: `Outbid. Raise your paddle.` |
| Win | Ghost hoists paddle: `The gavel fell your way.` |
| Error codes | `outbid_increment`: `Bid at least 43 NIM` (exact number). `host_cannot_bid`: `Hosts watch, bidders win.` `rate_limited`: `Easy, auctioneer.` `not_live`: `The gavel already fell.` `invalid_token`: `Paddle expired. Rejoin with your wallet.` |

All API failures show a single dim retry row, never modal spam.

## 10. Motion and sound

- 150ms ease-out for row entries, phase banner swaps, modal sheets. Nothing longer than 200ms except GavelSlam (600ms total sequence: flash 80ms, drop 200ms, arcs 200ms, stamp settle 120ms).
- Countdown digits do not animate; only the ring progress and the under-15s pulse.
- Sound (P2): short woodblock tick on new bid while room is in final 30s, single gavel slam WAV on SOLD, both with a visible mute toggle persisted in localStorage. No background music.
- Haptics: `navigator.vibrate(20)` inside GavelSlam if available (P2).

## 11. Asset manifest

| Path | Asset |
|---|---|
| `public/favicon.svg`, `public/favicon-192.png`, `public/apple-touch-icon.png` | gavel mark |
| `public/og-image.png` (1200x630) | mark + tagline + `nimgavel` on `--bg` |
| `public/ghost-*.svg` | mascot states: neutral, deflated, celebrating |
| `public/gavel-slam.wav` | 8-bit style gavel, <40KB |

## 12. Build rules

1. Build one route at a time: Lobby, then Room, then host, then settle. Verify each in the browser before the next.
2. No mock data in the UI once the API exists. Until the DO is live, the dev server may serve one seeded lot clearly labeled `seed lot` in code comments only, never on screen.
3. Every number shown comes from the server: current bid, minimum next bid, countdown end, server clock offset. The client never invents auction facts.
4. Test dark WebView rendering at 360px width (small Android) and 390px (iPhone) before sign-off.
5. Accessibility: bid button and banner are `aria-live`, feed list role `log`, all touch targets >= 44px.
6. Zero em dashes in all user-facing copy. Use periods.

## 13. Acceptance checklist

- [ ] Onboarding to first bid possible in under 60 seconds, 3 taps
- [ ] Room renders correct phase for every state in section 7
- [ ] GavelSlam plays on SOLD and the stamp shows final price + winner paddle
- [ ] Winner pay sheet triggers the native wallet dialog; cancel returns gracefully
- [ ] Receipt shows tx hash with explorer link after settle POST
- [ ] Spectate mode in plain browser with deeplink bar
- [ ] No placeholder text anywhere; empty states use ghost lines
- [ ] 360px and 390px widths clean; tabular numerals everywhere amounts tick
