var Wallet = function(options){
  this.id = options.id;
  this.key = options.key;
  this.recoveryId = options.recoveryId;

  this.keychainData = options.keychainData || {};
  this.mainData = options.mainData || {};
  this.recoveryData = options.recoveryData || {};
};

/**
 * Decrypts an encrypted wallet.
 *
 * @param {object} encryptedWallet
 * @param {string} encryptedWallet.id
 * @param {string} encryptedWallet.recoveryId
 * @param {string} encryptedWallet.mainData
 * @param {string} encryptedWallet.keychainData
 * @param {string} encryptedWallet.recoveryData
 * @param {string} id
 * @param {string} key
 *
 * @returns {Wallet}
 */
Wallet.decrypt = function(encryptedWallet, id, key){
  var rawKey = sjcl.codec.hex.toBits(key);

  var mainData = Wallet.decryptData(encryptedWallet.mainData, rawKey);
  var recoveryData = Wallet.decryptData(encryptedWallet.recoveryData, rawKey);
  var keychainData = Wallet.decryptData(encryptedWallet.keychainData, rawKey);

  var options = {
    id:           id,
    key:          key,
    recoveryId:   encryptedWallet.recoveryId,
    recoveryData: recoveryData,
    mainData:     mainData,
    keychainData: keychainData
  };

  return new Wallet(options);
};

/**
 * Encrypts the wallet data into a generic object.
 *
 * @returns {object}
 */
Wallet.prototype.encrypt = function(){
  var rawKey = sjcl.codec.hex.toBits(this.key);

  var encryptedMainData = Wallet.encryptData(this.mainData, rawKey);
  var encryptedRecoveryData = Wallet.encryptData(this.recoveryData, rawKey);
  var encryptedKeychainData = Wallet.encryptData(this.keychainData, rawKey);

  return {
    id:               this.id,
    authToken:        this.keychainData.authToken,
    recoveryId:       this.recoveryId,
    mainData:         encryptedMainData,
    mainDataHash:     sjcl.codec.hex.fromBits(sjcl.hash.sha1.hash(encryptedMainData)),
    keychainData:     encryptedKeychainData,
    keychainDataHash: sjcl.codec.hex.fromBits(sjcl.hash.sha1.hash(encryptedKeychainData)),
    recoveryData:     encryptedRecoveryData,
    recoveryDataHash: sjcl.codec.hex.fromBits(sjcl.hash.sha1.hash(encryptedRecoveryData))
  };
};

/**
 * Configure the data cryptography setting.
 */
Wallet.SETTINGS = {
  PBKDF2: {
    ITERATIONS: 1000,
    SIZE: 256 // Must be a valid AES key size.
  },

  SCRYPT: {
    N: Math.pow(2, 11),
    r: 8,
    p: 1,
    SIZE: 256
  },

  CIPHER_NAME: 'aes',
  MODE: 'ccm'
};

/**
 * Expand a username and password into an id and key using sjcl-scrypt.
 * Since the results must be deterministic, the credentials are used for the salt.
 *
 * id = scrypt(username + password)
 * key = scrypt(scrypt(username + password) + username + password)
 *
 * @param username
 * @param password
 * @returns {
 *   {
 *     id: {string},
 *     key: {string}
 *   }
 * }
 */

Wallet.deriveId = function(username, password){
  var credentials = username + password;
  var salt = credentials;

  var id = sjcl.misc.scrypt(
    credentials,
    salt,
    Wallet.SETTINGS.SCRYPT.N,
    Wallet.SETTINGS.SCRYPT.r,
    Wallet.SETTINGS.SCRYPT.p,
    Wallet.SETTINGS.SCRYPT.SIZE/8
  );

  return sjcl.codec.hex.fromBits(id);
};

Wallet.deriveKey = function(id, username, password){
  var credentials = username + password;
  var salt = credentials;

  var key = sjcl.misc.scrypt(
    id + credentials,
    id + salt,
    Wallet.SETTINGS.SCRYPT.N,
    Wallet.SETTINGS.SCRYPT.r,
    Wallet.SETTINGS.SCRYPT.p,
    Wallet.SETTINGS.SCRYPT.SIZE/8
  );

  return sjcl.codec.hex.fromBits(key);
};

/**
 * Encrypt data using 256bit AES in CBC mode with HMAC-SHA256 integrity checking.
 *
 * @param {object} data The data to encrypt.
 * @param {Array.<bits>} key The key used to encrypt the data.
 *
 * @return {string} The encrypted data encoded as base64.
 */
Wallet.encryptData = function(data, key) {
  // Encode data into a JSON byte array.
  var rawData = sjcl.codec.utf8String.toBits(JSON.stringify(data));

  // Initialize the cipher algorithm with the key.
  var cipher = new sjcl.cipher[Wallet.SETTINGS.CIPHER_NAME](key);

  // Encrypt the blob data in CBC mode using AES and a random 128bit IV.
  var rawIV = sjcl.random.randomWords(4);
  var rawCipherText = sjcl.mode[Wallet.SETTINGS.MODE].encrypt(cipher, rawData, rawIV);

  // Base 64 encode.
  var IV = sjcl.codec.base64.fromBits(rawIV);
  var cipherText = sjcl.codec.base64.fromBits(rawCipherText);

  // Pack the results into a JSON encoded string.
  var resultString = JSON.stringify({
    IV: IV,
    cipherText: cipherText,
    cipherName: Wallet.SETTINGS.CIPHER_NAME,
    mode: Wallet.SETTINGS.MODE
  });

  // Encode the JSON string as base64 to obscure it's structure.
  return btoa(resultString);
};

/**
 * Decrypt data using 256bit AES in CBC mode with HMAC-SHA256 integrity checking.
 *
 * @param {string} encryptedData The encrypted data encoded as base64.
 * @param {Array.<bits>} key The key used to decrypt the blob.
 */
Wallet.decryptData = function(encryptedData, key) {
  try {
    // Parse the base64 encoded JSON object.
    var resultObject = JSON.parse(atob(encryptedData));

    // Extract the cipher text from the encrypted data.
    var rawCipherText = sjcl.codec.base64.toBits(resultObject.cipherText);

    // Extract the cipher text from the encrypted data.
    var rawIV = sjcl.codec.base64.toBits(resultObject.IV);

    // Extract the cipher name from the encrypted data.
    var cipherName = resultObject.cipherName;
    var mode = resultObject.mode;
  } catch(e) {
    // The encoded data does not represent valid base64 values.
    throw('Data corrupt!');
  }

  // Initialize the cipher algorithm with the key.
  var cipher = new sjcl.cipher[cipherName](key);

  // Decrypt the data in CBC mode using AES and the given IV.
  var rawData = sjcl.mode[mode].decrypt(cipher, rawCipherText, rawIV);
  var data = sjcl.codec.utf8String.fromBits(rawData);

  // Parse and return the decrypted data as a JSON object.
  return JSON.parse(data);
};