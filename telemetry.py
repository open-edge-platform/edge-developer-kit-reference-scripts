# Update your test.py with debug capabilities
import requests
import uuid
import re
from system_info import get_system_info

def sanitize_string(text):
    """
    Remove special characters from string, keeping only alphanumeric, spaces, underscores, hyphens, and dots.
    Specifically removes (R) and (TM) trademark symbols.
    
    Args:
        text (str): Input string to sanitize
        
    Returns:
        str: Sanitized string with only allowed characters
    """
    if not isinstance(text, str):
        text = str(text)
    
    # First, specifically remove (R) and (TM) trademark symbols
    sanitized = re.sub(r'\(R\)|\(TM\)', '', text, flags=re.IGNORECASE)
    
    # Keep only alphanumeric characters, spaces, underscores, hyphens, and dots
    sanitized = re.sub(r'[^a-zA-Z0-9\s_.-]', '', sanitized)
    
    # Remove extra whitespace and strip
    sanitized = ' '.join(sanitized.split())
    
    return sanitized

def get_ga4_endpoint(country_code):
    """
    Determine the appropriate Google Analytics endpoint based on country code.
    EU countries should use region1.google-analytics.com for GDPR compliance.
    
    Args:
        country_code (str): Two-letter ISO country code
        
    Returns:
        str: Google Analytics endpoint URL
    """
    # EU country codes (including EEA countries)
    EU_COUNTRIES = {
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 
        'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 
        'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'
    }
    
    if country_code.upper() in EU_COUNTRIES:
        return "https://region1.google-analytics.com/mp/collect"
    else:
        return "https://www.google-analytics.com/mp/collect"

def send_system_telemetry():
    """Send system info to GA4"""
    system_info = get_system_info()
    
    # Extract key information for telemetry
    motherboard = f"{system_info['motherboard']['manufacturer']} {system_info['motherboard']['product']}"
    cpu_name = system_info['cpu']['name']
    discrete_gpus = [gpu['name'] for gpu in system_info['gpu'] if gpu['type'] == 'discrete']
    
    # Sanitize all string data before sending
    motherboard_clean = sanitize_string(motherboard)
    cpu_name_clean = sanitize_string(cpu_name)
    discrete_gpus_clean = [sanitize_string(gpu) for gpu in discrete_gpus]
    os_system_clean = sanitize_string(system_info['os']['system'])
    country_clean = sanitize_string(system_info['location']['country'])
    state_clean = sanitize_string(system_info['location']['state'])
    country_code_clean = sanitize_string(system_info['location']['country_code'])
    
    # Prepare telemetry data
    telemetry_data = {
        "client_id": str(uuid.uuid4()),
        "events": [{
            "name": "system_hardware_info",
            "params": {
                "scan_date": system_info['scan_date'],
                "motherboard": motherboard_clean,
                "cpu_name": cpu_name_clean,
                "cpu_cores": system_info['cpu']['cores'],
                "discrete_gpu_count": len(discrete_gpus_clean),
                "discrete_gpus": ", ".join(discrete_gpus_clean) if discrete_gpus_clean else "None",
                "os_system": os_system_clean,
                "country": country_clean,
                "state": state_clean,
                "country_code": country_code_clean
            }
        }]
    }
    
    # Determine appropriate endpoint based on location
    endpoint = get_ga4_endpoint(system_info['location']['country_code'])
    
    # Send to GA4
    response = requests.post(
        endpoint,
        params={
            "measurement_id": "G-9S2XYNP9PT",
            "api_secret": "UtjUpKWISMO4r9XeuPTNZQ"
        },
        json=telemetry_data
    )
    
    return response.status_code == 204

# Usage
if __name__ == "__main__":
    success = send_system_telemetry()
    print(f"Telemetry sent: {success}")