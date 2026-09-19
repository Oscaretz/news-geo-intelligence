import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_key = os.environ.get('ENCRYPTION_KEY')
if not _key:
    if os.environ.get('FLASK_ENV') == 'development' or os.path.exists('/.dockerenv') is False:
        # Generate an ephemeral key for local development
        _key = Fernet.generate_key().decode('utf-8')
        os.environ['ENCRYPTION_KEY'] = _key
    else:
        raise ValueError("ENCRYPTION_KEY environment variable is required in production.")

_cipher_suite = Fernet(_key.encode('utf-8'))

def encrypt_data(data: str) -> str:
    if not data:
        return data
    return _cipher_suite.encrypt(data.encode('utf-8')).decode('utf-8')

def decrypt_data(data: str) -> str:
    if not data:
        return data
    try:
        return _cipher_suite.decrypt(data.encode('utf-8')).decode('utf-8')
    except Exception:
        # If it fails to decrypt, it might not be encrypted (legacy data)
        return data
