#!/usr/bin/env python3
"""
Quick test to diagnose AWS credential issues.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from app.config import get_settings

settings = get_settings()

print(settings)

print("=== AWS Credential Check ===\n")
print(f"Access Key ID: {settings.aws_access_key_id[:8]}...{settings.aws_access_key_id[-4:] if len(settings.aws_access_key_id) > 12 else ''}")
secret_len = len(settings.aws_secret_access_key) if settings.aws_secret_access_key else 0
print(secret_len)
print(f"Secret Key: {'SET' if settings.aws_secret_access_key else 'NOT SET'} ({secret_len} chars)")
if secret_len > 0 and secret_len != 40:
    print(f"  [WARNING] Secret key should be 40 characters, but is {secret_len} characters!")
    print(f"  This is likely the problem - your secret key is incomplete or incorrect.")
print(f"Region: {settings.aws_region}")
print(f"Bucket: {settings.aws_s3_bucket_name}\n")

# Test 1: Try to create STS client (tests credentials)
print("Test 1: Testing credentials with STS...")
try:
    sts = boto3.client(
        'sts',
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region
    )
    identity = sts.get_caller_identity()
    print(f"[OK] Credentials valid!")
    print(f"  User ARN: {identity.get('Arn', 'N/A')}")
    print(f"  Account: {identity.get('Account', 'N/A')}")
except ClientError as e:
    error_code = e.response['Error']['Code']
    error_msg = e.response['Error']['Message']
    print(f"[FAIL] Error: {error_code}")
    print(f"  Message: {error_msg}")
    
    if error_code == 'InvalidClientTokenId':
        print("\n  Possible causes:")
        print("  1. Access Key ID doesn't exist or was deleted")
        print("  2. Access Key ID is correct but Secret Key is wrong")
        print("  3. Access Key was deactivated")
    elif error_code == 'SignatureDoesNotMatch':
        print("\n  Possible causes:")
        print("  1. Secret Access Key is incorrect")
        print("  2. Secret Access Key has extra spaces or characters")
except NoCredentialsError:
    print("✗ No credentials found")
except Exception as e:
    print(f"✗ Unexpected error: {e}")

# Test 2: Try to list buckets
print("\nTest 2: Testing S3 access...")
try:
    s3 = boto3.client(
        's3',
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region
    )
    buckets = s3.list_buckets()
    print(f"[OK] S3 access works!")
    print(f"  Buckets: {[b['Name'] for b in buckets['Buckets']]}")
    
    # Check if our bucket exists
    if settings.aws_s3_bucket_name:
        bucket_names = [b['Name'] for b in buckets['Buckets']]
        if settings.aws_s3_bucket_name in bucket_names:
            print(f"[OK] Target bucket '{settings.aws_s3_bucket_name}' found")
        else:
            print(f"[FAIL] Target bucket '{settings.aws_s3_bucket_name}' NOT found")
            print(f"  Available buckets: {', '.join(bucket_names) if bucket_names else 'None'}")
except ClientError as e:
    error_code = e.response['Error']['Code']
    error_msg = e.response['Error']['Message']
    print(f"[FAIL] Error: {error_code}")
    print(f"  Message: {error_msg}")
except Exception as e:
    print(f"[FAIL] Error: {e}")

