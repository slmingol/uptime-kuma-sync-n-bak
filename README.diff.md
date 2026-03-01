# Uptime Kuma Diff Tool

Compare monitors between two Uptime Kuma instances to identify differences.

## Features

- Compare all monitors between two instances
- Show monitors that exist in one instance but not the other
- Show detailed field-by-field differences for monitors that exist in both
- Configurable field filtering (ignore fields that are expected to differ)
- Clear, organized output

## Usage

### Using Named Instances

```bash
# Compare primary and secondary instances (full detail)
node uptime-kuma-diff.js primary secondary

# Show condensed summary (TL;DR mode)
node uptime-kuma-diff.js primary secondary --tldr

# Or use npm script
npm run diff primary secondary
npm run diff primary secondary --tldr

# Using bash wrapper
./diff-uptime.sh primary secondary
./diff-uptime.sh primary secondary --tldr
```

### Using Environment Variables

```bash
SOURCE_UPTIME_URL=https://uptime1.example.com \
SOURCE_UPTIME_USER=admin \
SOURCE_UPTIME_PASS=password1 \
TARGET_UPTIME_URL=https://uptime2.example.com \
TARGET_UPTIME_USER=admin \
TARGET_UPTIME_PASS=password2 \
node uptime-kuma-diff.js

# With TL;DR mode
SOURCE_UPTIME_URL=... node uptime-kuma-diff.js --tldr
```

## Configuration

Configure ignored fields in `uptime-kuma-config.json`:

```json
{
  "diff": {
    "ignoreFields": [
      "id",
      "userId",
      "created_date",
      "updated_date",
      "notificationIDList"
    ]
  }
}
```

### Default Ignored Fields

By default, these fields are ignored as they're instance-specific:
- `id` - Monitor ID (different per instance)
- `userId` - User ID (different per instance)
- `created_date` - Creation timestamp
- `updated_date` - Last update timestamp
- `docker_host` - Docker host reference
- `parent` - Parent monitor reference
- `path` - Monitor path
- `path_name` - Monitor path name
- `notificationIDList` - Notification settings

## Output Format

The diff tool provides two output modes:

### Full Detail Mode (default)

Provides complete field-by-field comparison:

1. **Summary**: Quick overview of differences
   - Number of identical monitors
   - Number of monitors with differences
   - Number of monitors only in source
   - Number of monitors only in target

2. **Only in Source**: Monitors that exist in source but not target
3. **Only in Target**: Monitors that exist in target but not source
4. **Monitors with Differences**: Detailed field-by-field comparison showing old and new values

### TL;DR Mode (`--tldr` flag)

Condensed summary perfect for quick overview:

1. **Summary**: Same as full mode
2. **Only in Source/Target**: Same as full mode
3. **Monitors with Differences**: Just monitor names and number of different fields
4. **Most Common Differences**: Top 10 fields that differ across monitors

Use `--tldr` when you want a quick overview without the detailed field values.

### Example Output (Full Detail Mode)

```
==============================
UPTIME KUMA DIFF REPORT
==============================
Source: primary (https://uptime1.example.com)
Target: secondary (https://uptime2.example.com)
==============================

Summary:
  Identical: 195
  Different: 3
  Only in primary: 2
  Only in secondary: 1
  Total: 201

--- Monitors only in PRIMARY (2) ---
  • New Monitor 1 [http]
    URL: https://example.com
  • New Monitor 2 [ping]
    Host: 192.168.1.1:N/A

--- Monitors with differences (3) ---

  Monitor: Web Server [http]
  Differences (2):
    • url:
      primary: https://web1.example.com
      secondary: https://web2.example.com
    • tags:
      primary: [1,2,3]
      secondary: [1,2]
```

### Example Output (TL;DR Mode)

```
==============================
UPTIME KUMA DIFF REPORT
==============================
Source: primary (https://uptime1.example.com)
Target: secondary (https://uptime2.example.com)
==============================

Summary:
  Identical: 195
  Different: 3
  Only in primary: 2
  Only in secondary: 1
  Total: 201

--- Monitors only in PRIMARY (2) ---
  • New Monitor 1 [http]
    URL: https://example.com
  • New Monitor 2 [ping]
    Host: 192.168.1.1:N/A

--- Monitors with differences (3) ---
  • Web Server [http] - 2 field(s) different
  • Database Monitor [port] - 1 field(s) different
  • API Check [http] - 3 field(s) different

--- Most common differences ---
  • tags: 31 monitor(s)
  • childrenIDs: 9 monitor(s)
  • url: 2 monitor(s)
```
      primary: 60
      secondary: 120
    • maxretries:
      primary: 3
      secondary: 5
```

## Use Cases

### Before Syncing

Check what will change before running a sync:

```bash
npm run diff primary secondary
npm run sync primary secondary
```

### Determining Sync Direction

The sync tool is bi-directional and safe. Use diff to determine which instance has the correct configuration:

```bash
# 1. Compare both directions
./diff-uptime.sh primary secondary --tldr
./diff-uptime.sh secondary primary --tldr

# 2. Review the differences:
#    - Which instance has the correct tags/groups?
#    - Which has the latest monitor configurations?
#    - Which has monitors you want to keep?

# 3. Sync FROM your "source of truth" TO the other instance
./sync-uptime.sh <correct-instance> <target-instance>

# 4. Verify they're now in sync
./diff-uptime.sh primary secondary --tldr
```

**Example:** If your diff shows secondary has correct tags on 31 monitors and 1 extra monitor:
```bash
# Secondary is the source of truth, sync it to primary
./sync-uptime.sh secondary primary

# Verify - should now show "Identical: 202, Different: 0"
./diff-uptime.sh secondary primary --tldr
```

**Safety:** Each sync automatically backs up the target instance to `uptime-kuma-backups/` before making changes.

### After Syncing

Verify that sync completed successfully:

```bash
npm run sync primary secondary
npm run diff primary secondary  # Should show 0 differences
```

### Monitoring Drift

Regularly compare instances to detect configuration drift:

```bash
# Weekly cron job
0 0 * * 0 cd /path/to/uptime-kuma-sync-n-bak && npm run diff primary secondary
```

### Troubleshooting

Identify why monitors behave differently between instances:

```bash
npm run diff primary secondary | grep "Monitor Name"
```

## Tips

- **Use with sync**: Run diff before sync to preview changes
- **Customize ignoreFields**: Add fields to ignore based on your use case
- **Save output**: Redirect to file for record keeping: `npm run diff primary secondary > diff-report.txt`
- **Filter output**: Pipe to grep/awk to focus on specific monitors

## Related Tools

- `uptime-kuma-sync.js` - Synchronize monitors between instances
- `uptime-kuma-backup.js` - Backup an instance
- `uptime-kuma-restore.js` - Restore an instance
