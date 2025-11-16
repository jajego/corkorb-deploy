#!/usr/bin/env python3
"""Test script for AWS Rekognition setup."""

import sys
import io

# Fix Windows encoding issues
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from app.config import get_settings
from app.services import s3 as s3_service

# ANSI color codes (with fallback for terminals that don't support them)
try:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
except:
    GREEN = RED = YELLOW = BLUE = BOLD = RESET = ''


def print_header(text):
    print(f"\n{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}{text}{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")


def print_success(text):
    print(f"{GREEN}✓{RESET} {text}")


def print_error(text):
    print(f"{RED}✗{RESET} {text}")


def print_warning(text):
    print(f"{YELLOW}⚠{RESET} {text}")


def print_info(text):
    print(f"{BLUE}ℹ{RESET} {text}")


def test_rekognition_client():
    """Test 1: Rekognition client initialization."""
    print_header("Test 1: Rekognition Client Initialization")
    
    settings = get_settings()
    
    try:
        rekognition = boto3.client(
            'rekognition',
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region
        )
        
        print_success("Rekognition client initialized")
        print_info(f"Region: {settings.aws_region}")
        return rekognition
        
    except NoCredentialsError:
        print_error("AWS credentials not found or invalid")
        return None
    except Exception as e:
        print_error(f"Failed to initialize Rekognition client: {e}")
        return None


def test_rekognition_with_s3_image(rekognition_client):
    """Test 2: Rekognition with S3 image."""
    print_header("Test 2: Rekognition Content Moderation (S3 Image)")
    
    settings = get_settings()
    
    # Check bucket region (Rekognition must be in same region as S3)
    print_info("Checking S3 bucket region...")
    try:
        s3_client = s3_service.get_s3_client()
        bucket_location = s3_client.get_bucket_location(Bucket=settings.aws_s3_bucket_name)
        bucket_region = bucket_location.get('LocationConstraint') or 'us-east-1'  # us-east-1 returns None
        print_info(f"S3 bucket region: {bucket_region}")
        
        if bucket_region != settings.aws_region:
            print_warning(f"Bucket region ({bucket_region}) differs from configured region ({settings.aws_region})")
            print_warning("Rekognition must be in the same region as S3 bucket")
            print_info(f"Creating Rekognition client for region: {bucket_region}")
            rekognition_client = boto3.client(
                'rekognition',
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                region_name=bucket_region,
            )
    except Exception as e:
        print_warning(f"Could not determine bucket region: {e}")
        print_info("Continuing with configured region...")
    
    # Create a simple test image (1x1 red pixel PNG)
    import base64
    # Minimal valid PNG (1x1 red pixel)
    png_data = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
    
    # Upload test image to S3
    test_key = f"test/rekognition-test.png"
    
    try:
        s3_client = s3_service.get_s3_client()
        s3_client.put_object(
            Bucket=settings.aws_s3_bucket_name,
            Key=test_key,
            Body=png_data,
            ContentType='image/png',
        )
        print_success(f"Uploaded test image to S3: {test_key}")
        
        # Get S3 URI for Rekognition
        s3_uri = {
            'S3Object': {
                'Bucket': settings.aws_s3_bucket_name,
                'Name': test_key
            }
        }
        
        # Call Rekognition
        print_info("Calling Rekognition DetectModerationLabels...")
        response = rekognition_client.detect_moderation_labels(
            Image=s3_uri,
            MinConfidence=50.0
        )
        
        moderation_labels = response.get('ModerationLabels', [])
        
        if moderation_labels:
            print_warning(f"Found {len(moderation_labels)} moderation label(s):")
            for label in moderation_labels:
                name = label.get('Name', 'Unknown')
                confidence = label.get('Confidence', 0)
                print_info(f"  - {name}: {confidence:.1f}% confidence")
        else:
            print_success("No moderation labels detected (image is safe)")
        
        # Clean up test image
        s3_client.delete_object(
            Bucket=settings.aws_s3_bucket_name,
            Key=test_key
        )
        print_success("Cleaned up test image")
        
        return True
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        
        if error_code == 'AccessDeniedException':
            print_error("Access denied to Rekognition")
            print_info("Check IAM permissions for rekognition:DetectModerationLabels")
        elif error_code == 'InvalidS3ObjectException':
            print_error("Invalid S3 object")
            print_info(f"Message: {error_message}")
        else:
            print_error(f"Rekognition error: {error_code}")
            print_info(f"Message: {error_message}")
        
        # Try to clean up
        try:
            s3_client = s3_service.get_s3_client()
            s3_client.delete_object(
                Bucket=settings.aws_s3_bucket_name,
                Key=test_key
            )
        except:
            pass
        
        return False
        
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        return False


def main():
    """Run all tests."""
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}  AWS Rekognition Test Script{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")
    
    settings = get_settings()
    print(f"Access Key ID: {settings.aws_access_key_id[:8]}...")
    print(f"Region: {settings.aws_region}")
    print(f"S3 Bucket: {settings.aws_s3_bucket_name}")
    print(f"Min Confidence: {settings.rekognition_min_confidence}")
    
    # Test 1: Client initialization
    rekognition = test_rekognition_client()
    if not rekognition:
        print(f"\n{RED}{BOLD}Tests failed: Could not initialize Rekognition client{RESET}")
        sys.exit(1)
    
    # Test 2: Rekognition API call
    success = test_rekognition_with_s3_image(rekognition)
    
    # Summary
    print_header("Test Summary")
    if success:
        print_success("All tests passed!")
        print(f"\n{GREEN}{BOLD}Rekognition is configured correctly.{RESET}")
    else:
        print_error("Some tests failed")
        print(f"\n{RED}{BOLD}Please check AWS setup and IAM permissions.{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()

