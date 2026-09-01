import platform
import subprocess  # nosec B404
import json
import re
import sys
import requests
from datetime import datetime

def get_location_info():
    """Get location information based on IP address (country and state/region)"""
    location_info = {
        'country': 'Unknown',
        'country_code': 'Unknown',
        'state': 'Unknown'
    }
    
    # Multiple API services as fallbacks
    services = [
        {
            'url': 'https://ipapi.co/json/',
            'timeout': 5,
            'fields': {
                'country': 'country_name',
                'country_code': 'country_code', 
                'state': 'region'
            }
        },
        {
            'url': 'https://ipinfo.io/json',
            'timeout': 5,
            'fields': {
                'country': 'country',
                'country_code': 'country',
                'state': 'region'
            }
        },
        {
            'url': 'http://ip-api.com/json/',
            'timeout': 5,
            'fields': {
                'country': 'country',
                'country_code': 'countryCode',
                'state': 'regionName'
            }
        }
    ]
    
    for i, service in enumerate(services):
        try:
            #print(f"Trying location service {i+1}/3: {service['url']}")
            response = requests.get(service['url'], timeout=service['timeout'])
            
            #print(f"Response status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                #print(f"Raw response: {data}")
                
                # Extract fields based on service-specific field names
                fields = service['fields']
                
                country = data.get(fields['country'], '').strip()
                country_code = data.get(fields['country_code'], '').strip()
                state = data.get(fields['state'], '').strip()
                
                # Validate that we got meaningful data
                if country and country.lower() != 'unknown' and len(country) > 1:
                    location_info['country'] = country
                    location_info['country_code'] = country_code if country_code else 'Unknown'
                    location_info['state'] = state if state else 'Unknown'
                    
                    #print(f"✅ Location detected: {country}, {state} ({country_code})")
                    break
                else:
                    print(f"⚠️  Service returned empty/invalid data")
                    
            else:
                pass
                #print(f"❌ HTTP error: {response.status_code}")
                
        except requests.exceptions.Timeout:
            print(f"⚠️  Service {i+1} timeout")
        except requests.exceptions.ConnectionError:
            print(f"⚠️  Service {i+1} connection error")
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Service {i+1} request error: {e}")
        except Exception as e:
            print(f"⚠️  Service {i+1} unexpected error: {e}")
    
    if location_info['country'] == 'Unknown':
        print("❌ All location services failed")
    
    return location_info

def get_motherboard_info():
    """Get motherboard information"""
    motherboard_info = {
        'manufacturer': 'Unknown',
        'product': 'Unknown'
    }
    
    try:
        if platform.system() == "Linux":
            # Linux - using dmidecode
            try:
                result = subprocess.run(['sudo', 'dmidecode', '-t', 'baseboard'], 
                                      capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    output = result.stdout
                    
                    # Parse manufacturer
                    manufacturer_match = re.search(r'Manufacturer:\s*(.+)', output)
                    if manufacturer_match:
                        motherboard_info['manufacturer'] = manufacturer_match.group(1).strip()
                    
                    # Parse product name
                    product_match = re.search(r'Product Name:\s*(.+)', output)
                    if product_match:
                        motherboard_info['product'] = product_match.group(1).strip()
                        
            except Exception as e:
                print(f"Linux motherboard detection error: {e}")
                # Try alternative method without sudo
                try:
                    with open('/sys/class/dmi/id/board_vendor', 'r') as f:
                        motherboard_info['manufacturer'] = f.read().strip()
                    with open('/sys/class/dmi/id/board_name', 'r') as f:
                        motherboard_info['product'] = f.read().strip()
                except Exception as e2:
                    print(f"Alternative Linux motherboard detection error: {e2}")
                    
    except Exception as e:
        print(f"General motherboard detection error: {e}")
    
    return motherboard_info

def get_cpu_info():
    """Get CPU information"""
    cpu_info = {
        'name': 'Unknown',
        'cores': 0
    }
    
    try:
        if platform.system() == "Linux":
            # Linux - using /proc/cpuinfo
            try:
                with open('/proc/cpuinfo', 'r') as f:
                    cpuinfo = f.read()
                    
                # Get CPU name
                name_match = re.search(r'model name\s*:\s*(.+)', cpuinfo)
                if name_match:
                    cpu_info['name'] = name_match.group(1).strip()
                
                # Count physical cores
                core_id_matches = re.findall(r'^core id\s*:\s*(\d+)', cpuinfo, re.MULTILINE)
                if core_id_matches:
                    unique_cores = len(set(core_id_matches))
                    cpu_info['cores'] = unique_cores
                else:
                    # Fallback to processor count if core id not available
                    cores = len(re.findall(r'^processor\s*:', cpuinfo, re.MULTILINE))
                    cpu_info['cores'] = cores
                    
            except Exception as e:
                print(f"Linux CPU detection error: {e}")
                
        # Fallback to platform module
        if cpu_info['name'] == 'Unknown':
            cpu_info['name'] = platform.processor()
            
    except Exception as e:
        print(f"General CPU detection error: {e}")
    
    return cpu_info

def get_gpu_info():
    """Get GPU information using clinfo (preferred) with lspci fallback"""
    gpu_list = []
    
    try:
        if platform.system() == "Linux":
            # Method 1: Try clinfo first (better for driver-detected GPUs)
            try:
                result = subprocess.run(['clinfo', '-l'], capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        if 'Device #' in line:
                            # Extract device name
                            device_match = re.search(r'Device #\d+:\s*(.+)', line)
                            if device_match:
                                gpu_name = device_match.group(1).strip()
                                
                                # Determine if discrete or integrated based on name patterns
                                gpu_type = 'integrated'
                                gpu_lower = gpu_name.lower()
                                
                                # Check for discrete GPU indicators
                                if any(discrete in gpu_lower for discrete in 
                                      ['arc', 'nvidia', 'geforce', 'quadro', 'tesla', 'rtx', 'gtx',
                                       'amd radeon', 'rx ', 'radeon pro', 'radeon hd', 'vega']):
                                    gpu_type = 'discrete'
                                # Intel integrated patterns to keep as integrated
                                elif any(integrated in gpu_lower for integrated in 
                                        ['uhd graphics', 'hd graphics', 'iris']):
                                    gpu_type = 'integrated'
                                    
                                gpu_list.append({
                                    'name': gpu_name,
                                    'type': gpu_type
                                })
                                
            except Exception as e:
                print(f"clinfo GPU detection error: {e}")
            
            # Method 2: Fallback to lspci if clinfo didn't find anything or failed
            if not gpu_list:
                try:
                    result = subprocess.run(['lspci', '-nn'], capture_output=True, text=True, timeout=10)
                    if result.returncode == 0:
                        lines = result.stdout.split('\n')
                        for line in lines:
                            if 'VGA compatible controller' in line or 'Display controller' in line:
                                # Extract GPU name
                                gpu_match = re.search(r':\s*(.+?)\s*\[', line)
                                if gpu_match:
                                    gpu_name = gpu_match.group(1).strip()
                                    
                                    # Basic discrete/integrated detection for lspci fallback
                                    gpu_type = 'integrated'
                                    gpu_lower = gpu_name.lower()
                                    
                                    if any(discrete in gpu_lower for discrete in 
                                          ['nvidia', 'geforce', 'quadro', 'tesla', 'rtx', 'gtx',
                                           'amd radeon', 'rx ', 'radeon pro']):
                                        gpu_type = 'discrete'
                                        
                                    gpu_list.append({
                                        'name': gpu_name,
                                        'type': gpu_type
                                    })
                                    
                except Exception as e:
                    print(f"lspci GPU detection error: {e}")
                
    except Exception as e:
        print(f"General GPU detection error: {e}")
    
    return gpu_list

def get_system_info():
    """Get complete system information"""
    
    # Get OS information from /etc/os-release if available (Linux)
    os_system = platform.system()
    if os_system == "Linux":
        try:
            with open('/etc/os-release', 'r') as f:
                for line in f:
                    if line.startswith('PRETTY_NAME='):
                        # Extract the value and remove quotes
                        os_system = line.split('=', 1)[1].strip().strip('"\'')
                        break
        except Exception as e:
            print(f"Could not read /etc/os-release: {e}")
            # Fall back to platform.system()
    
    system_info = {
        'scan_date': datetime.now().strftime('%Y%m%d'),
        'os': {
            'system': os_system
        },
        'location': get_location_info(),
        'motherboard': get_motherboard_info(),
        'cpu': get_cpu_info(),
        'gpu': get_gpu_info()
    }
    
    return system_info

def print_system_info(info):
    """Print system information in a readable format"""
    print("\n" + "="*60)
    print("SYSTEM INFORMATION")
    print("="*60)
    print(f"Scan Date: {info['scan_date']}")
    
    # OS Information
    print(f"\n🖥️  OPERATING SYSTEM:")
    print(f"   System: {info['os']['system']}")
    
    # Location Information
    print(f"\n🌍 LOCATION:")
    print(f"   Country: {info['location']['country']}")
    print(f"   State/Region: {info['location']['state']}")
    print(f"   Country Code: {info['location']['country_code']}")
    
    # Motherboard Information
    print(f"\n🔧 MOTHERBOARD:")
    mb = info['motherboard']
    print(f"   Manufacturer: {mb['manufacturer']}")
    print(f"   Product: {mb['product']}")

    
    # CPU Information
    print(f"\n⚡ PROCESSOR:")
    cpu = info['cpu']
    print(f"   Name: {cpu['name']}")
    print(f"   Cores: {cpu['cores']}")

    
    # GPU Information
    print(f"\n🎮 GRAPHICS:")
    if info['gpu']:
        discrete_gpus = [gpu for gpu in info['gpu'] if gpu['type'] == 'discrete']
        integrated_gpus = [gpu for gpu in info['gpu'] if gpu['type'] == 'integrated']
        
        if discrete_gpus:
            print(f"   Discrete GPU(s):")
            for i, gpu in enumerate(discrete_gpus, 1):
                print(f"     {i}. {gpu['name']}")
        else:
            print(f"   Discrete GPU(s): None detected")
            
        if integrated_gpus:
            print(f"   Integrated GPU(s):")
            for i, gpu in enumerate(integrated_gpus, 1):
                print(f"     {i}. {gpu['name']}")
    else:
        print(f"   No graphics cards detected")
    
    print("="*60)

def main():
    """Main function"""
    try:
        print("Gathering system information...")
        system_info = get_system_info()
        print_system_info(system_info)
        return system_info
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Scan interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error during system scan: {e}")
        sys.exit(1)

if __name__ == "__main__":
    system_info = main()
