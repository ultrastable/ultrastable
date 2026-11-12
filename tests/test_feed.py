import requests

def test_get_proof():
    response = requests.get('http://localhost:5000/proof')
    assert response.status_code == 200
    assert response.json() == {"status": "success", "message": "Product-side feed"}