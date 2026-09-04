# Orb Cleanup Cron Job

This directory contains the cron job script for cleaning up old orbs that haven't been accessed in 14 days.

## What It Does

The `cleanup_old_orbs.py` script:
- Finds all orbs where `last_accessed` is older than 14 days (or `created_at` if `last_accessed` is NULL)
- Deletes all associated papers and S3 images for each orb
- Logs all operations for monitoring
- **Closes all database connections and exits cleanly** (required for Railway cron jobs)
- Uses async context managers to ensure proper cleanup

## Setting Up on Railway

Railway supports native cron jobs that execute your service's start command on a schedule. The service must complete its task and exit cleanly (closing all connections).

**Important Requirements:**
- The service must exit as soon as the task completes
- All database connections must be closed before exit
- If a previous execution is still running, Railway will skip the next scheduled run
- Minimum frequency: 5 minutes between executions
- All schedules are in UTC timezone

### Option 1: Railway Dashboard (Recommended)

1. **Create a new service** in your Railway project:
   - Click "New" → "Empty Service"
   - Name it something like "Orb Cleanup Cron"

2. **Connect to your repository**:
   - Connect the same GitHub repository
   - Railway will detect it's a Python project

3. **Configure the cron schedule**:
   - Go to the service settings
   - Find "Cron Schedule" field
   - Enter a crontab expression (5 fields: minute, hour, day of month, month, day of week)
   - Examples:
     - `0 3 * * *` - Daily at 3:00 AM UTC
     - `0 0 * * *` - Daily at midnight UTC
     - `0 */6 * * *` - Every 6 hours
     - `0 0 1 * *` - Monthly on the 1st at midnight UTC
   - **Note**: Schedules are in UTC, so adjust for your timezone if needed

4. **Set the start command**:
   - In the service settings, under "Start Command", set:
     ```
     python -m app.cron.cleanup_old_orbs
     ```
   - **Important**: The `railway.json` file no longer has a default start command, so you MUST set this in the Railway dashboard for each service:
     - **Main API service**: Set to `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (`railway.json` runs migrations before deployment)
     - **Cron service**: Set to `python -m app.cron.cleanup_old_orbs`
   - Railway runs commands from the root of your repository. If your `api` folder is at the root, this should work. If Railway's working directory is different, you may need:
     ```
     cd api && python -m app.cron.cleanup_old_orbs
     ```
   - Or set the working directory in Railway service settings to `api/`

5. **Configure environment variables**:
   - Make sure all required environment variables are set:
     - `DATABASE_URL` (Railway provides this automatically if you link the database)
     - `APP_AWS_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID`
     - `APP_AWS_SECRET_ACCESS_KEY` or `AWS_SECRET_ACCESS_KEY`
     - `APP_AWS_S3_BUCKET_NAME` or `AWS_S3_BUCKET_NAME`
     - `APP_AWS_REGION` or `AWS_REGION`
     - Any other required env vars from your main service

6. **Deploy**:
   - Railway will automatically run the script on the schedule you specified

### Option 2: Using Railway CLI

If you prefer using the Railway CLI, you can configure it via `railway.json` or the CLI:

```bash
railway service create --name "orb-cleanup"
railway cron schedule "0 3 * * *" --command "python -m app.cron.cleanup_old_orbs"
```

### Cron Schedule Examples

Crontab format: `minute hour day-of-month month day-of-week` (all in UTC)

- `0 3 * * *` - Daily at 3:00 AM UTC
- `0 0 * * *` - Daily at midnight UTC
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Weekly on Sunday at midnight UTC (0 = Sunday)
- `0 0 1 * *` - Monthly on the 1st at midnight UTC
- `30 9 * * 1-5` - Every weekday (Mon-Fri) at 9:30 AM UTC
- `*/15 * * * *` - Every 15 minutes (minimum is 5 minutes: `*/5 * * * *`)

**Important Notes:**
- All times are in UTC
- Minimum frequency: 5 minutes (`*/5 * * * *`)
- Railway may vary execution time by a few minutes

## Testing Locally

You can test the script locally before deploying:

```bash
# Make sure you're in the api directory
cd api

# Set up your environment variables
export DATABASE_URL="postgresql+psycopg://..."
export APP_AWS_ACCESS_KEY_ID="..."
# ... etc

# Run the script
python -m app.cron.cleanup_old_orbs
```

## Monitoring

The script logs all operations:
- Number of orbs found for deletion
- Each orb being deleted (with age and timestamps)
- Success/failure for each deletion
- Final summary with total deleted and errors

Check Railway logs to monitor the cron job execution.

## Configuration

You can adjust the retention period by modifying `RETENTION_DAYS` in `cleanup_old_orbs.py`:

```python
APP_ORB_RETENTION_DAYS=14
```

## Troubleshooting

### Script exits immediately
- Check that all environment variables are set correctly
- Verify database connection is working
- Check Railway logs for error messages

### No orbs are being deleted
- Verify that `last_accessed` is being updated when orbs are accessed
- Check that the cutoff date calculation is correct
- Review the logs to see how many orbs were found

### S3 deletion fails
- The script will continue even if S3 deletion fails (it logs a warning)
- Check AWS credentials and permissions
- Verify S3 bucket name is correct

### Cron job is being skipped
- **If a previous execution is still running, Railway will skip the next scheduled run**
- Check Railway logs to see if previous executions are taking too long
- Consider reducing the number of orbs processed per run or optimizing the cleanup script
- Ensure the script exits properly (check for hanging database connections or async tasks)
