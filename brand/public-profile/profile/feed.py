from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/proof', methods=['GET'])
def get_proof():
    return jsonify({"status": "success", "message": "Product-side feed"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)