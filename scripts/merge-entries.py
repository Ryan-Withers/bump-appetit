#!/usr/bin/env python3
# Merges the per-group entry files into data/entries.json.
#
# The one thing this has to catch is a collision between files. Each group was
# written independently, so two of them can easily claim "reflux" or "wind",
# and the first owner keeps it. Every drop is printed rather than silently
# resolved, because a lost alias is a search that returns nothing at 3am.
import json, glob, os, sys

SP = '/tmp/claude-0/-home-user-bump-appetit/1c38d3c1-463b-52a3-a9f7-8df850b3262f/scratchpad/bub'
OUT = '/home/user/bump-appetit/data/entries.json'

GROUP_ORDER = ['Sleep', 'Feeding', 'Crying', 'Nappies', 'Skin & body',
               'Illness', 'Milestones', 'You two']

# Each group was written by a different pass, so the same panic got written
# twice from two angles. Harmless on a "normal" entry; dangerous on a "call"
# one, where two cards gave two different answers to the same question. These
# were reviewed as pairs and the stricter, better-routed one kept. The loser's
# aliases move across so neither search stops working.
#
#   loser                            -> winner           why
SUPERSEDED = {
    # 13 HEALTH is Queensland only, and these two are in Victoria.
    'dehydration-signs':              'dehydration',
    # One said MCH nurse, one said GP. Not enough milk can move fast: GP.
    'fewer-wet-nappies-than-expected':'fewer-wet-nappies',
    # One said GP, one said 000. A weak or high-pitched cry is a red flag.
    'weak-or-unusual-cry':            'weak-or-high-pitched-cry',
    # One called it watch, one call. Thrush needs treating, so call wins.
    'thrush-nappy-rash':              'nappy-thrush',
    # Same advice twice over.
    'white-noise-for-crying':         'white-noise',
    'teething-and-crying':            'teething',
    # Two entries, same name, different groups. Spit up is a feeding question.
    'posseting-or-vomiting':          'posseting-vs-vomiting',
    # Same name, two groups. A dream feed is a sleep tactic more than a feed.
    'dream-feeds':                    'dream-feed',
    # Both call, same advice. The stump one sits beside cord-stump-care.
    'cord-infection':                 'cord-stump-infection',
}

# An entry that cannot be found by its own obvious name is not in the app. The
# golden search tests caught "nappy thrush" losing to plain nappy rash, which
# is a call entry losing to a watch one.
ALIAS_ADD = {
    'nappy-thrush': ['nappy thrush'],
}

entries, log = [], []
moved_aliases = {}
seen_ids, alias_owner, name_owner = set(), {}, {}

for path in sorted(glob.glob(os.path.join(SP, 'entries-*.json'))):
    name = os.path.basename(path)
    try:
        batch = json.load(open(path))['entries']
    except Exception as err:
        log.append(f'UNREADABLE {name}: {err}')
        continue
    for e in batch:
        if not e or not e.get('id'):
            continue
        if e['id'] in seen_ids:
            log.append(f'DUPLICATE ID dropped: {e["id"]} ({name})')
            continue
        if e['id'] in SUPERSEDED:
            winner = SUPERSEDED[e['id']]
            moved_aliases.setdefault(winner, []).extend(e.get('aliases', []))
            log.append(f'SUPERSEDED: {e["id"]} folded into {winner}')
            continue
        seen_ids.add(e['id'])
        entries.append(e)
    log.append(f'{name}: {len(batch)} read')

for target_id, extra in ALIAS_ADD.items():
    moved_aliases.setdefault(target_id, []).extend(extra)

for winner, extra in moved_aliases.items():
    target = next((e for e in entries if e['id'] == winner), None)
    if target:
        target['aliases'] = list(dict.fromkeys(target.get('aliases', []) + extra))
    else:
        log.append(f'WARNING: {winner} does not exist, its aliases are lost')

# Names are search targets too, so an alias may not shadow a different entry's name.
for e in entries:
    name_owner[e['name'].strip().lower()] = e['id']

for e in entries:
    kept = []
    for a in e.get('aliases', []):
        clean = str(a).lower().strip()
        if len(clean) < 3:
            log.append(f'alias too short, dropped: "{clean}" ({e["id"]})')
            continue
        if clean in alias_owner:
            log.append(f'alias collision, dropped: "{clean}" ({e["id"]}, held by {alias_owner[clean]})')
            continue
        if name_owner.get(clean) and name_owner[clean] != e['id']:
            log.append(f'alias shadows a name, dropped: "{clean}" ({e["id"]} vs {name_owner[clean]})')
            continue
        alias_owner[clean] = e['id']
        kept.append(clean)
    if not kept:
        fallback = e['name'].strip().lower()
        if fallback not in alias_owner:
            alias_owner[fallback] = e['id']
            kept = [fallback]
            log.append(f'{e["id"]} lost every alias; given its own name')
        else:
            log.append(f'ENTRY DROPPED, no usable alias: {e["id"]}')
    e['aliases'] = kept

# 13 HEALTH is Queensland only and these two live in Melbourne. Routing a
# frightened parent to a number that will not answer is the worst bug this app
# could carry, so it is normalised to "Nurse line", which the app resolves
# against CONFIG.contacts: Victoria's 24 hour MCH Line and NURSE-ON-CALL.
state_fix = 0

def reroute(holder):
    # Variants carry their own prose, so this has to walk them too: the first
    # pass missed one buried in the poo colour chart.
    global state_fix
    for field in ('why', 'whatToDo'):
        text = holder.get(field)
        if isinstance(text, str) and '13 HEALTH' in text:
            text = text.replace('13 HEALTH on 13 43 25 84', 'your 24 hour nurse line')
            holder[field] = text.replace('13 HEALTH', 'your 24 hour nurse line')
            state_fix += 1

for e in entries:
    if e.get('whoToCall') == '13 HEALTH':
        e['whoToCall'] = 'Nurse line'
        state_fix += 1
    reroute(e)
    for v in (e.get('variants') or []):
        reroute(v)
if state_fix:
    log.append(f'STATE FIX: {state_fix} references to a Queensland-only line rerouted')

entries = [e for e in entries if e.get('aliases')]
entries.sort(key=lambda e: (GROUP_ORDER.index(e['group']) if e['group'] in GROUP_ORDER else 99,
                            -int(e.get('popularity') or 0), e['name']))

json.dump({'schema': 1, 'entries': entries}, open(OUT, 'w'), indent=1, ensure_ascii=False)
open(OUT, 'a').write('\n')

print('\n'.join(log))
from collections import Counter
print(f'\nmerged {len(entries)} entries, {len(alias_owner)} search terms')
print('by group: ' + ', '.join(f'{g} {n}' for g, n in Counter(e['group'] for e in entries).most_common()))
print('by tier:  ' + ', '.join(f'{t} {n}' for t, n in Counter(e['tier'] for e in entries).most_common()))
