# WHATZ IT?

WHATZ IT? is a social guessing game whose rounds may be played locally or together through SharePlay.

## Shared Play

**Shared Round Settings**:
The game mode and round duration copied from the inviter's deck details when SharePlay opens and then owned by that SharePlay setup.
_Avoid_: SharePlay settings

**Session Host**:
The participant currently responsible for the authoritative state of a SharePlay session.
_Avoid_: Owner

**Session Controller**:
The participant authorized to change shared round settings and control the flow of rounds in a SharePlay session.
_Avoid_: Host

**Turn Owner**:
The participant whose role controls the active turn: the guesser in Classic or the starting player in Pass n Play.
_Avoid_: Starting player, guesser

**Resume Owner**:
The participant with authority to resume a particular paused turn. This is initially the participant who paused it and may transfer if that participant leaves.
_Avoid_: Pause owner

**Results Viewer**:
A participant currently viewing the results for a particular completed round, regardless of when they opened that results screen.
_Avoid_: Results participant

**Shared Cue**:
A synchronized game moment that prompts each participant's device to provide its own locally preferred feedback.
_Avoid_: Shared sound

## Recording

**No Recording**:
A completed round for which no playable video footage was captured or retained.
_Avoid_: Failed recording

**Incomplete Recording**:
A round recording that retains valid captured footage but ends before the round itself is complete.
_Avoid_: Failed recording, partial video
