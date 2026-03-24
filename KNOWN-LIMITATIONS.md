# Known Limitations

## Tag Syncing

**Status**: Not fully functional via Socket.IO API

### Issue
While monitor tags can be viewed and fetched via the Uptime Kuma Socket.IO API, the `editMonitor` event does not persist tag associations when updating monitors. Tags can be successfully:
- Retrieved via `getTags` and `getMonitor` events
- Created via `addTag` event
- Included in monitor data structures

However, when tags are included in monitor objects sent via `editMonitor`, they are accepted (API returns OK) but not persisted to the database.

### Testing Results
- ✅ **Groups/Parent relationships**: Working perfectly - 191 monitors correctly organized
- ✅ **Monitors with matching IDs**: Tags persist when source and target monitor IDs match
- ❌ **Monitors with different IDs**: Tags are lost when monitors require parent updates in second pass
- ✅ **Manual tag addition**: Works via Uptime Kuma UI

### Root Cause
The `editMonitor` Socket.IO event does not handle the monitor_tag junction table. Tags appear to require either:
1. Separate API calls (not documented in Socket.IO interface)
2. Direct database manipulation
3. Being set only during initial monitor creation via `add` event

### Workaround
Manually add tags via the Uptime Kuma UI after syncing monitors. Monitor groups and hierarchies will sync correctly.

### Affected Monitors
Monitors where source and target IDs don't match (typically ~15 monitors out of 208):
- Game monitors (WEB - Connections, Strands, Contexto, cat-climber, etc.)
- Entertainment monitors (seerr, etc.)
- Any monitor that requires ID remapping

### Future Resolution
This limitation requires investigation of Uptime Kuma's source code or community documentation to find the correct API for managing monitor-tag associations programmatically.

## Other Notes
- Parent field preservation required two-pass sync implementation
- Shell script flag passing was fixed to support `--deep` mode
- Monitor IDs are correctly mapped between instances
