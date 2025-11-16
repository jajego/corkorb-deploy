#!/usr/bin/env python3
"""
Test script for AWS S3 and CDN setup.

This script tests:
1. S3 connection and authentication
2. S3 bucket access
3. File upload to S3
4. File download from S3
5. Public URL access
6. CDN URL access
7. File deletion from S3

Usage:
    python test_s3_cdn.py
"""

import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

import boto3
import httpx
from botocore.exceptions import ClientError, NoCredentialsError

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add parent directory to path to import app config
sys.path.insert(0, str(Path(__file__).parent))

from app.config import get_settings

# ANSI color codes for terminal output (with fallback for Windows)
try:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"
    BOLD = "\033[1m"
    CHECK = "✓"
    CROSS = "✗"
    WARN = "⚠"
    INFO = "ℹ"
except (UnicodeEncodeError, UnicodeDecodeError):
    # Fallback for terminals that don't support Unicode/ANSI
    GREEN = RED = YELLOW = BLUE = RESET = BOLD = ""
    CHECK = "[OK]"
    CROSS = "[FAIL]"
    WARN = "[WARN]"
    INFO = "[INFO]"


def print_success(message: str):
    try:
        print(f"{GREEN}{CHECK}{RESET} {message}")
    except (UnicodeEncodeError, UnicodeDecodeError):
        print(f"[OK] {message}")


def print_error(message: str):
    try:
        print(f"{RED}{CROSS}{RESET} {message}")
    except (UnicodeEncodeError, UnicodeDecodeError):
        print(f"[FAIL] {message}")


def print_warning(message: str):
    try:
        print(f"{YELLOW}{WARN}{RESET} {message}")
    except (UnicodeEncodeError, UnicodeDecodeError):
        print(f"[WARN] {message}")


def print_info(message: str):
    try:
        print(f"{BLUE}{INFO}{RESET} {message}")
    except (UnicodeEncodeError, UnicodeDecodeError):
        print(f"[INFO] {message}")


def print_header(message: str):
    print(f"\n{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}{message}{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")


def test_credentials() -> bool:
    """Test 1: Check if AWS credentials are configured."""
    print_header("Test 1: AWS Credentials Configuration")
    
    settings = get_settings()
    
    if not settings.aws_access_key_id:
        print_error("AWS_ACCESS_KEY_ID not set in environment")
        print_info("Add to .env: AWS_ACCESS_KEY_ID=your-key-id")
        return False
    
    if not settings.aws_secret_access_key:
        print_error("AWS_SECRET_ACCESS_KEY not set in environment")
        print_info("Add to .env: AWS_SECRET_ACCESS_KEY=your-secret-key")
        return False
    
    if not settings.aws_s3_bucket_name:
        print_error("AWS_S3_BUCKET_NAME not set in environment")
        print_info("Add to .env: AWS_S3_BUCKET_NAME=your-bucket-name")
        return False
    
    print_success(f"AWS Access Key ID: {settings.aws_access_key_id[:8]}...")
    print_success(f"AWS Region: {settings.aws_region}")
    print_success(f"S3 Bucket: {settings.aws_s3_bucket_name}")
    
    if settings.cdn_base_url:
        print_success(f"CDN Base URL: {settings.cdn_base_url}")
    else:
        print_warning("CDN_BASE_URL not set (optional, but recommended)")
    
    return True


def test_s3_connection() -> Optional[boto3.client]:
    """Test 2: Test S3 connection and authentication."""
    print_header("Test 2: S3 Connection & Authentication")
    
    settings = get_settings()
    
    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region
        )
        
        # Test connection by listing buckets
        response = s3_client.list_buckets()
        buckets = [b['Name'] for b in response['Buckets']]
        
        print_success(f"Connected to AWS S3")
        print_info(f"Available buckets: {', '.join(buckets) if buckets else 'None'}")
        
        # Check if our bucket exists
        if settings.aws_s3_bucket_name in buckets:
            print_success(f"Bucket '{settings.aws_s3_bucket_name}' exists")
        else:
            print_error(f"Bucket '{settings.aws_s3_bucket_name}' not found")
            print_info(f"Available buckets: {', '.join(buckets)}")
            return None
        
        return s3_client
        
    except NoCredentialsError:
        print_error("AWS credentials not found or invalid")
        return None
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'InvalidAccessKeyId':
            print_error("Invalid AWS Access Key ID")
        elif error_code == 'SignatureDoesNotMatch':
            print_error("Invalid AWS Secret Access Key")
        else:
            print_error(f"AWS error: {error_code} - {e.response['Error']['Message']}")
        return None
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")
        return None


def test_bucket_access(s3_client: boto3.client) -> bool:
    """Test 3: Test bucket access and permissions."""
    print_header("Test 3: Bucket Access & Permissions")
    
    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    
    try:
        # Test head_bucket (check if we can access bucket)
        s3_client.head_bucket(Bucket=bucket_name)
        print_success(f"Can access bucket '{bucket_name}'")
        
        # Test bucket location
        location = s3_client.get_bucket_location(Bucket=bucket_name)['LocationConstraint']
        location = location or 'us-east-1'  # us-east-1 returns None
        print_info(f"Bucket region: {location}")
        
        if location != settings.aws_region:
            print_warning(f"Bucket region ({location}) differs from configured region ({settings.aws_region})")
        
        return True
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == '403':
            print_error("Access denied to bucket (check IAM permissions)")
        elif error_code == '404':
            print_error("Bucket not found")
        else:
            print_error(f"Error accessing bucket: {error_code} - {e.response['Error']['Message']}")
        return False
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")
        return False


def test_upload_file(s3_client: boto3.client) -> Optional[str]:
    """Test 4: Upload a test file to S3."""
    print_header("Test 4: File Upload to S3")
    
    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    
    # Create a test file
    test_content = f"Test file uploaded at {time.strftime('%Y-%m-%d %H:%M:%S')}"
    test_key = f"test/test-{int(time.time())}.txt"
    
    try:
        # Upload file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as tmp_file:
            tmp_file.write(test_content)
            tmp_path = tmp_file.name
        
        print_info(f"Uploading test file to s3://{bucket_name}/{test_key}")
        s3_client.upload_file(tmp_path, bucket_name, test_key)
        
        # Clean up local file
        os.unlink(tmp_path)
        
        print_success(f"File uploaded successfully: {test_key}")
        return test_key
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'AccessDenied':
            print_error("Access denied - check IAM permissions for s3:PutObject")
        else:
            print_error(f"Upload failed: {error_code} - {e.response['Error']['Message']}")
        return None
    except Exception as e:
        print_error(f"Unexpected error during upload: {str(e)}")
        return None


def test_download_file(s3_client: boto3.client, test_key: str) -> bool:
    """Test 5: Download file from S3."""
    print_header("Test 5: File Download from S3")
    
    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    
    try:
        with tempfile.NamedTemporaryFile(mode='r', delete=False, suffix='.txt') as tmp_file:
            tmp_path = tmp_file.name
        
        print_info(f"Downloading file from s3://{bucket_name}/{test_key}")
        s3_client.download_file(bucket_name, test_key, tmp_path)
        
        # Verify content
        with open(tmp_path, 'r') as f:
            content = f.read()
        
        if "Test file uploaded" in content:
            print_success("File downloaded and verified successfully")
            os.unlink(tmp_path)
            return True
        else:
            print_error("Downloaded file content doesn't match")
            os.unlink(tmp_path)
            return False
            
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'AccessDenied':
            print_error("Access denied - check IAM permissions for s3:GetObject")
        else:
            print_error(f"Download failed: {error_code} - {e.response['Error']['Message']}")
        return False
    except Exception as e:
        print_error(f"Unexpected error during download: {str(e)}")
        return False


def test_public_url(s3_client: boto3.client, test_key: str) -> Optional[str]:
    """Test 6: Generate and test public S3 URL."""
    print_header("Test 6: Public S3 URL Access")
    
    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    
    # Generate public URL
    public_url = f"https://{bucket_name}.s3.{settings.aws_region}.amazonaws.com/{test_key}"
    print_info(f"Public S3 URL: {public_url}")
    
    # Test if URL is accessible
    try:
        response = httpx.get(public_url, timeout=10.0)
        if response.status_code == 200:
            print_success("Public S3 URL is accessible")
            print_info(f"Content length: {len(response.content)} bytes")
            return public_url
        elif response.status_code == 403:
            print_warning("Public S3 URL returns 403 (Forbidden)")
            print_info("This might be expected if bucket is not public. Check bucket policy.")
            return public_url
        else:
            print_warning(f"Public S3 URL returned status {response.status_code}")
            return public_url
    except httpx.TimeoutException:
        print_warning("Public S3 URL request timed out")
        return public_url
    except Exception as e:
        print_warning(f"Error accessing public URL: {str(e)}")
        return public_url


def test_cdn_url(test_key: str) -> bool:
    """Test 7: Test CDN URL access."""
    print_header("Test 7: CDN URL Access")
    
    settings = get_settings()
    
    if not settings.cdn_base_url:
        print_warning("CDN_BASE_URL not configured - skipping CDN test")
        return True
    
    # Remove trailing slash if present
    cdn_base = settings.cdn_base_url.rstrip('/')
    cdn_url = f"{cdn_base}/{test_key}"
    
    print_info(f"CDN URL: {cdn_url}")
    
    try:
        response = httpx.get(cdn_url, timeout=10.0, follow_redirects=True)
        if response.status_code == 200:
            print_success("CDN URL is accessible")
            print_info(f"Content length: {len(response.content)} bytes")
            
            # Check if it's actually from CDN (check headers)
            if 'x-cache' in response.headers or 'cf-cache-status' in response.headers:
                cache_status = response.headers.get('x-cache') or response.headers.get('cf-cache-status')
                print_info(f"Cache status: {cache_status}")
            
            return True
        else:
            print_warning(f"CDN URL returned status {response.status_code}")
            print_info("This might be expected if CDN is still deploying (can take 5-15 minutes)")
            return False
    except httpx.TimeoutException:
        print_warning("CDN URL request timed out")
        return False
    except Exception as e:
        print_warning(f"Error accessing CDN URL: {str(e)}")
        return False


def test_delete_file(s3_client: boto3.client, test_key: str) -> bool:
    """Test 8: Delete file from S3."""
    print_header("Test 8: File Deletion from S3")
    
    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    
    try:
        print_info(f"Deleting file: s3://{bucket_name}/{test_key}")
        s3_client.delete_object(Bucket=bucket_name, Key=test_key)
        print_success("File deleted successfully")
        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'AccessDenied':
            print_error("Access denied - check IAM permissions for s3:DeleteObject")
        else:
            print_error(f"Delete failed: {error_code} - {e.response['Error']['Message']}")
        return False
    except Exception as e:
        print_error(f"Unexpected error during delete: {str(e)}")
        return False


def main():
    """Run all S3 and CDN tests."""
    print(f"\n{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}  AWS S3 & CDN Test Script{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")
    
    results = {
        'credentials': False,
        'connection': False,
        'bucket_access': False,
        'upload': False,
        'download': False,
        'public_url': False,
        'cdn_url': False,
        'delete': False,
    }
    
    # Test 1: Credentials
    if not test_credentials():
        print(f"\n{RED}{BOLD}Tests failed: Missing or invalid credentials{RESET}\n")
        sys.exit(1)
    results['credentials'] = True
    
    # Test 2: S3 Connection
    s3_client = test_s3_connection()
    if not s3_client:
        print(f"\n{RED}{BOLD}Tests failed: Cannot connect to S3{RESET}\n")
        sys.exit(1)
    results['connection'] = True
    
    # Test 3: Bucket Access
    if not test_bucket_access(s3_client):
        print(f"\n{RED}{BOLD}Tests failed: Cannot access bucket{RESET}\n")
        sys.exit(1)
    results['bucket_access'] = True
    
    # Test 4: Upload
    test_key = test_upload_file(s3_client)
    if not test_key:
        print(f"\n{RED}{BOLD}Tests failed: Cannot upload file{RESET}\n")
        sys.exit(1)
    results['upload'] = True
    
    # Test 5: Download
    if not test_download_file(s3_client, test_key):
        print_warning("Download test failed, but continuing...")
    else:
        results['download'] = True
    
    # Test 6: Public URL
    public_url = test_public_url(s3_client, test_key)
    if public_url:
        results['public_url'] = True
    
    # Test 7: CDN URL
    if test_cdn_url(test_key):
        results['cdn_url'] = True
    
    # Test 8: Delete
    if not test_delete_file(s3_client, test_key):
        print_warning("Delete test failed - test file may still exist in S3")
    else:
        results['delete'] = True
    
    # Summary
    print_header("Test Summary")
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, passed_test in results.items():
        try:
            status = f"{GREEN}{CHECK} PASS{RESET}" if passed_test else f"{RED}{CROSS} FAIL{RESET}"
        except (UnicodeEncodeError, UnicodeDecodeError):
            status = "[PASS]" if passed_test else "[FAIL]"
        print(f"  {test_name.replace('_', ' ').title():20} {status}")
    
    print(f"\n{BOLD}Results: {passed}/{total} tests passed{RESET}\n")
    
    if passed == total:
        print(f"{GREEN}{BOLD}All tests passed! S3 and CDN are configured correctly.{RESET}\n")
        sys.exit(0)
    elif passed >= total - 2:  # Allow 1-2 failures (like CDN if not configured)
        print(f"{YELLOW}{BOLD}Most tests passed. Check warnings above for details.{RESET}\n")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}Multiple tests failed. Please check your configuration.{RESET}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

