/**
 *
 * nsclient adapter,
 *		copyright McM1957 2022, MIT
 *
 */

/*
 * Some general REMINDERS for further development
 *
 * - Ensure that every timer value is less than 0x7fffffff - otherwise the time will fire immidiatly
 *
 */

/*
 * description if major internal objects
 *
 *	CTXs		object (array) of CTX objectes
 *
 *  CTX         object for one signle device
 *    containing
 *      name        string  name of the device
 *      id          string  id of device, dereived from name
 *      ipAddr      string  ip address (without port number)
 *      ipPort      number  ip port number
 *      user        string  username to connect to client
 *      pwd         string  password to connect to client
 *      timeout     number  snmp connect timeout (ms)
 *      pollIntvl   number  snmp poll intervall (ms)
 *      chkCpu      bool    true if standard cpu checks to be performed
 *      chkMem      bool    true if standard memory checks to be performed
 *      chkDrives   bool    true if standard drive checks to be performed
 *
 *      url         string  url to connect to client
 *      busy        bool    flag to avoid too fast polling
 *      initialized bool    flag indicating initialization status of device
 *      offline     bool    flag indicating connection status of device
 *      pollTimer   object  timer object for poll timer
 *      queries     array   array of query names stored as strings
 */

'use strict';

const QUERIES = {
    'info': {
        query: '/api/v1/info',
        parser: parseInfo
    },
    'check_cpu': {
        query: '/api/v1/queries/check_cpu/commands/execute',
        parser: parsePerf
    },
    'check_drivesize': {
        query: '/api/v1/queries/check_drivesize/commands/execute',
        parser: parsePerf
    },
    'check_memory': {
        query: '/api/v1/queries/check_memory/commands/execute',
        parser: parsePerf
    },
};

const HTTP_CODES = {
    '100': 'Continue',
    '101': 'Switching Protocols',
    '102': 'Processing',
    '103': 'Early Hints',
    '200': 'OK',
    '201': 'Created',
    '202': 'Accepted',
    '203': 'Non-Authoritative Information',
    '204': 'No Content',
    '205': 'Reset Content',
    '206': 'Partial Content',
    '207': 'Multi-Status',
    '208': 'Already Reported',
    '226': 'IM Used',
    '300': 'Multiple Choices',
    '301': 'Moved Permanently',
    '302': 'Found',
    '303': 'See Other',
    '304': 'Not Modified',
    '305': 'Use Proxy',
    '307': 'Temporary Redirect',
    '308': 'Permanent Redirect',
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '402': 'Payment Required',
    '403': 'Forbidden',
    '404': 'Not Found',
    '405': 'Method Not Allowed',
    '406': 'Not Acceptable',
    '407': 'Proxy Authentication Required',
    '408': 'Request Timeout',
    '409': 'Conflict',
    '410': 'Gone',
    '411': 'Length Required',
    '412': 'Precondition Failed',
    '413': 'Payload Too Large',
    '414': 'URI Too Long',
    '415': 'Unsupported Media Type',
    '416': 'Range Not Satisfiable',
    '417': 'Expectation Failed',
    '418': "I'm a Teapot",
    '421': 'Misdirected Request',
    '422': 'Unprocessable Entity',
    '423': 'Locked',
    '424': 'Failed Dependency',
    '425': 'Too Early',
    '426': 'Upgrade Required',
    '428': 'Precondition Required',
    '429': 'Too Many Requests',
    '431': 'Request Header Fields Too Large',
    '451': 'Unavailable For Legal Reasons',
    '500': 'Internal Server Error',
    '501': 'Not Implemented',
    '502': 'Bad Gateway',
    '503': 'Service Unavailable',
    '504': 'Gateway Timeout',
    '505': 'HTTP Version Not Supported',
    '506': 'Variant Also Negotiates',
    '507': 'Insufficient Storage',
    '508': 'Loop Detected',
    '509': 'Bandwidth Limit Exceeded',
    '510': 'Not Extended',
    '511': 'Network Authentication Required'
};

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
//const { EXIT_CODES } = require('@iobroker/js-controller-common');

// Load modules required by adapter
const https = require('https');

// #################### global variables ####################
let adapter;            // adapter instance - @type {ioBroker.Adapter}
const CTXs = [];		// see description at header of file
const STATEs = [];		// cache of already created caches


// #################### general utility functions ####################

/**
 * Convert name to id
 *
 *		This utility routine replaces all forbidden chars and the characters '-' and any whitespace
 *		with an underscore ('_').
 *
 * @param   {string}    pName 	name of an object
 * @return  {string} 		    name of the object with all forbidden chars replaced
 *
 */
function name2id(pName) {
    return (pName || '').replace(adapter.FORBIDDEN_CHARS, '_').replace(/[%]/g, 'pct').replace(/[-\s]/g, '_');
}

/**
 * handleOffline - process online status of device switches to offline
 *
 * @param   {object}    pCTX    device context
 * @param   {string}    pMsg    error message to log
 * @return  nothing
 *
 */
function handleOffline (pCTX, pMsg) {
    adapter.log.debug('handleOffline - ' + pCTX.name  );

    if ( ! pCTX.offline ){
        if (pMsg && pMsg !== '') { adapter.log.warn('[' + pCTX.name + '] ' + pMsg  ); }
        adapter.log.info('[' + pCTX.name + '] offline');
    }
    pCTX.offline = true;
}

/**
 * handleOnline - process online status of device switches to online
 *
 * @param   {object}    pCTX    device context
 * @param   {string}    pMsg    info message to log
 * @return  nothing
 *
 */
function handleOnline (pCTX, pMsg) {
    adapter.log.debug('handleOnline - ' + pCTX.name  );

    if ( pCTX.offline ){
        if (pMsg && pMsg !== '') { adapter.log.info('[' + pCTX.name + '] ' + pMsg  ); }
        adapter.log.info('[' + pCTX.name + '] online');
    }
    pCTX.offline = false;
}

// #################### state functions ####################
/**
 * initObject - create single object
 *
 *		creates object if it does not exist
 *		waits for action to complete using await
 *
 * @param   {object}  pObj    object structure
 * @return  nothing
 *
 */
async function initObject(pObj) {
    adapter.log.debug('initobject - ' + pObj._id);
    try {
        await adapter.extendObjectAsync(pObj._id, pObj);
    } catch (e) {
        adapter.log.error('error initializing obj "' + pObj._id + '" ' + e.message);
    }
}

/**
 * updateState - create and set a state object
 *
 *		creates a stae object if it does not exist and
 *      set the state value
 *		waits for action to complete using await
 *
 * @param   {string}    pId     state id
 * @param   {any}       pValue  new value the of the state
 * @param   {number}    pQual   quality code of the state
 * @param   {object}    pCommon object containing common part of state object
 * @return  nothing
 *
 */
async function updateState( pId, pValue, pQual, pCommon ) {
    adapter.log.debug('updateState - ' + pId);

    if ( ! STATEs[pId] || STATEs[pId].type !== pCommon.type) {
        await initObject({
            _id: pId,
            type: 'state',
            common: pCommon,
            native: { }
        });
        if ( ! STATEs[pId] ) { STATEs[pId] = {}; }
        STATEs[pId].type = pCommon.type;
    }

    await adapter.setStateAsync(pId, {val: pValue, ack: true, q:pQual} );
    adapter.log.debug('state ' + pId + ' updated (value ' + pValue +')');
}

/**
 * initDeviceObject - create device object
 *
 *		creates device object if it does not exist
 *		waits for action to complete using await
 *
 * @param   {string}    pId   object id
 * @param   {string}    pName object name
 * @return  nothing
 *
 */
async function initDeviceObject(pId, pName) {
    adapter.log.debug('initFolderObject - ' + pId);
    const obj = {
        _id: pId,
        type: 'device',
        common: {
            name: pName
        },
        native: {
        }
    };
    await initObject( obj );
}

/**
 * initFolderObject - create folder object
 *
 *		creates folder object if it does not exist
 *		waits for action to complete using await
 *
 * @param   {string}    pId   object id
 * @param   {string}    pName object name
 * @return  nothing
 *
 */
async function initFolderObject(pId, pName) {
    adapter.log.debug('initFolderObject - ' + pId);
    const obj = {
        _id: pId,
        type: 'folder',
        common: {
            name: pName
        },
        native: {
        }
    };
    await initObject( obj );
}

/**
 * initBaseObjects - create base state objects for a single device
 *
 * @param   {object}    pCTX    device context
 * @return  nothing
 *
 */
async function initBaseObjects ( pCTX ) {
    adapter.log.debug('initBaseObjects - ' + pCTX.name  );

    // <name>
    await initDeviceObject(pCTX.id, pCTX.name);

    // <name>.* folder
    await initFolderObject(pCTX.id+'.info', '');
    //    if ( pCTX.chkCpu )    { await initFolderObject(pCTX.id+'.cpu', ''); }
    //    if ( pCTX.chkDrives ) { await initFolderObject(pCTX.id+'.drives', ''); }
    //    if ( pCTX.chkMem )    { await initFolderObject(pCTX.id+'.mem', ''); }

    // <name>.online state
    await updateState(pCTX.id + '.online', false, 0, {
        name: pCTX.name + ' online',
        type: 'boolean',
        role: 'indicator.reachable',
        read: true,
        write: false
    });
}

/**
 * initAllBaseObjects - create base state objects for all devices
 *
 * @return  nothing
 *
 */
async function initAllBaseObjects() {
    adapter.log.debug('initAllBaseObjects - init all base objects for all device');

    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];
        await initBaseObjects(CTX);
    }
}

/**
 * parseInfo - parse the json returned by command 'info'
 *
 *      NOTE: all parseXxxx fucntions must use identical parameters
 *
 * @param   {object}    pCTX    device context
 * @param   {object}    pJdata  json object as returnd by client
 * @return  nothing
 *
 */
async function parseInfo(pCTX, pJdata)
{
    adapter.log.debug('parseInfo - ' + pCTX.id );

    // note info folder should already exist
    await updateState(pCTX.id+'.info.name', pJdata.name, 0, {
        name: 'client name',
        type: 'string',
        role: 'info.name',
        read: true,
        write: false
    });

    await updateState(pCTX.id+'.info.version', pJdata.version, 0, {
        name: 'client version',
        type: 'string',
        role: 'info.version',
        read: true,
        write: false
    });

}

/**
 * parsePerf - parse the json returned by any command with perf data (check_cpu, check_memory, ...)
 *
 *      NOTE: all parseXxxx fucntions must use identical parameters
 *
 * @param   {object}    pCTX    device context
 * @param   {object}    pJdata  json object as returnd by client
 * @return  nothing
 *
 */
async function parsePerf( pCTX, pJdata)
{
    adapter.log.debug('parsePerf - ' + pCTX.id );

    const command = pJdata['command'];

    const baseId = name2id( pCTX.id + '.' + command );
    await initFolderObject (baseId, '');
    await updateState(baseId + '.result', pJdata.result, 0, {
        name: 'result',
        type: 'number',
        role: 'value.severity',
        read: true,
        write: false,
        states: {0: 'ok', 1: 'warning', 2: 'error', 3: 'delayed'}
    });

    // TODO: check if more than one line could be returned
    await updateState(baseId + '.message', pJdata.lines[0].message, 0, {
        name: 'message',
        type: 'string',
        role: 'text',
        read: true,
        write: false
    });

    await initFolderObject (baseId + '.perf', '');
    for(const perfKey in pJdata.lines[0].perf){
        const perfId = name2id (baseId + '.perf' + '.' + perfKey);
        await initFolderObject (perfId, '');
        for(const state in pJdata.lines[0].perf[perfKey]){
            const stateId = name2id (baseId + '.perf' + '.' + perfKey + '.' + state);
            const stateVal = pJdata.lines[0].perf[perfKey][state];
            const isNum = /^\d+(\.\d+)?$/.test(stateVal);
            await updateState(stateId, stateVal, 0, {
                name: state,
                type: isNum?'number':'string',
                role: 'value',
                read: true,
                write: false
            });
        }
    }
}

// #################### network functions ####################
/**
 * httpsGetAsync - async call to https
 *
 * @param   {string}    pUrl    url to query
 * @param   {number}    pTmo    timeout (ms)
 * @return  {Promise}   return info structure
 *
 */
async function httpsGetAsync( pUrl, pTmo ){
    adapter.log.debug('httpsGetAsync - ' + pUrl );
    const ret= {};
    ret.httpCode=0;
    ret.errCode=0;
    ret.errText='';
    ret.data='';

    return new Promise((resolve,_reject)=>{
        const options= {
            rejectUnauthorized: false,
            timeout: pTmo
        };
        const req = https.get( pUrl, options, (res) => {
            console.log('statusCode:', res.statusCode);
            ret.httpCode = res.statusCode||0;
            // console.log('headers:', res.headers);

            res.on('data', (d) => {
                console.log('at on');
                console.log(d.toString());
                ret.data=d;
                resolve(ret);
            });
        });
        req.on('timeout', () => {
            ret.httpCode=408; //
            resolve(ret);
        });
        req.on('error', (e) => {
            // @ts-ignore
            if ( e && e.code !== 'HPE_INVALID_CONSTANT' )
            {
                // @ts-ignore
                ret.errCode = e.code;
                ret.errText = e.toString();
                resolve(ret);
            }
        });
    });
}

/**
 * httpsGetAsync - async call to https
 *
 * @param   {object}    pCTX        device context
 * @param   {string}    pQuery  name of query
 * @return  object  data        query result (or empty string)
 *                  jdata       parsed query result
 *                  errCode     any error occured
 *                  errText     any error text
 *                  httpCode    any error occured
 *
 */
async function executeQuery ( pCTX, pQuery) {
    adapter.log.debug('executeQuery - ' + pQuery );

    const url = pCTX.url + QUERIES [ pQuery ].query;
    const ret = await httpsGetAsync( url, pCTX.timeout );
    if ( ret.errCode ) {
        adapter.log.debug ('[' + pCTX.name + '] ' + ret.errCode + ' - ' + ret.errText );
        handleOffline(pCTX, ret.errCode + ' - ' + ret.errText);
    }
    else if (ret.httpCode !== 200) {
        adapter.log.debug ('[' + pCTX.name + '] HTTP error [' + ret.httpCode + '] ' + HTTP_CODES[ret.httpCode]);
        handleOffline(pCTX, 'HTTP error [' + ret.httpCode + '] ' + HTTP_CODES[ret.httpCode]);
    } else {
        adapter.log.debug ('[' + pCTX.name + '] data retrieved "' + ret.data.toString() + '"');
        handleOnline(pCTX, '');
        ret.jdata = JSON.parse( ret.data );
    }
    return ret;
}


// #################### scanning functions ####################

/**
 * scanDevice - scan a single device
 *
 * @param   pCTX    context of a single device
 * @return  nothing
 *
 */
async function scanDevice ( pCTX ){
    const name = pCTX.name;
    adapter.log.debug('[' + name + '] scanDevice starting');

    if (pCTX.busy){
        adapter.log.warn('[' + name + '] device is still busy - scan interval should be increased');
        return;
    }
    pCTX.busy = true;

    if ( ! pCTX.initialized )
    {
        const ret = await executeQuery( pCTX, 'info' );
        if ( ret.jdata ) {
            QUERIES['info'].parser( pCTX, ret.jdata );
            adapter.log.info('[' + name + '] device connected, client ' + ret.jdata.name + ' / ' + ret.jdata.version);
            pCTX.initialized = true;
        }
    }

    for (let ii = 0; pCTX.initialized && (ii < pCTX.queries.length); ii++) {
        const query = pCTX.queries[ii];
        adapter.log.debug('[' + name + '] processing query [' + ii + '] ' + query );
        const ret = await executeQuery( pCTX, query );
        if (! ret.jdata) {
            adapter.log.debug('[' + name + '] processing query index [' + ii + '] aborted' );
            break;
        }
        QUERIES[query].parser( pCTX, ret.jdata );
        adapter.log.debug('[' + name + '] processing query index [' + ii + '] completed' );
    }

    pCTX.busy = false;
    adapter.log.debug('[' + name + '] scanDevice completed');
}

// #################### initialization functions ####################

/**
 * startReaderThreads - start a reader thread per device
 *
 * @return nothing
 *
 */
function startReaderThreads() {
    adapter.log.debug('startReaderThreads - starting reader threads');

    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];
        setImmediate(scanDevice, CTX);
        CTX.pollTimer = adapter.setInterval(scanDevice, CTX.pollIntvl, CTX);
    }
}

/**
 * setupContices - setup contices for worker threads
 *
 * @return  nothing
 *
 */
function setupContices() {
    adapter.log.debug('setupContices - initializing contices');

    for (let ii = 0, jj = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) {
            continue;
        }

        adapter.log.debug('adding device "' + dev.devIpAddr + '" (' + dev.devName + ')' );
        adapter.log.debug('timing parameter: timeout ' + dev.devTimeout + 's , polling ' + dev.devPollIntvl + 's');

        // TODO: ipV6 support
        const tmp = (dev.devIpAddr||'').trim ().split(':');
        const ipAddr = tmp[0];
        const ipPort = tmp[1] || 8443;

        CTXs[jj] = {};
        CTXs[jj].name = (dev.devName||'').trim();
        CTXs[jj].id = name2id(CTXs[jj].name);
        CTXs[jj].ipAddr = ipAddr;
        CTXs[jj].ipPort = ipPort;
        CTXs[jj].user = (dev.devUser||'').trim();
        CTXs[jj].pwd = (dev.devPwd||'').trim();
        CTXs[jj].timeout = (dev.devTimeout||1) * 1000;       //s -> ms must be less than 0x7fffffff
        CTXs[jj].pollIntvl = (dev.devPollIntvl||1) * 1000;   //s -> ms must be less than 0x7fffffff

        CTXs[jj].chkCpu = (dev.devChkCpu || false );
        CTXs[jj].chkMem = (dev.devChkMem || false );
        CTXs[jj].chkDrives = (dev.devChkDrives || false );

        CTXs[jj].url = 'https://' + CTXs[jj].user + ':' + CTXs[jj].pwd + '@'+CTXs[jj].ipAddr + ':' + CTXs[jj].ipPort;

        CTXs[jj].busy = false;
        CTXs[jj].initialized = false;
        CTXs[jj].offline = false;

        CTXs[jj].queries = [];
        if ( CTXs[jj].chkCpu )    { CTXs[jj].queries.push('check_cpu'); }
        if ( CTXs[jj].chkDrives ) { CTXs[jj].queries.push('check_drivesize'); }
        if ( CTXs[jj].chkMem )    { CTXs[jj].queries.push('check_memory'); }

        CTXs[jj].pollTimer = null;  // poll intervall timer

        jj++;
    }
}

/**
 * validateConfig - scan and validate config data
 *
 * @return
 *
 */
function validateConfig() {
    let ok = true;

    adapter.log.debug('validateConfig - verifying devices');

    // ensure that at least an empty config exists
    adapter.config.devs = adapter.config.devs || [];

    if (!adapter.config.devs.length) {
        adapter.log.error('no devices configured, please add configuration.');
        ok = false;
    }

    const chkDevNames = {};
    for (let ii = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) continue;

        dev.devName = (dev.devName||'').trim();
        dev.devIpAddr = (dev.devIpAddr||'').trim();

        if (dev.devName.endsWith('.')) {
            adapter.log.error('devicename "' + dev.devName + '"is invalid. Name must not end with ".". Please correct configuration.');
            ok = false;
        }
        if (dev.devName.includes('..')) {
            adapter.log.error('devicename "' + dev.devName + '"is invalid. Name must not include consecutive dots. Please correct configuration.');
            ok = false;
        }
        if ( chkDevNames[dev.devName] ) {
            adapter.log.error('devicenames must be unique, "' + dev.devName + '"use more than once, please correct configuration.');
            ok = false;
        }
        chkDevNames[dev.devName] = 'x';

        // IP addr might be an IPv4 address, and IPv6 address or a dsn name
        if (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(dev.devIpAddr)) {
            /* ipv4 - to be checked further */
        } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
            /* domain name */
        } else {
            adapter.log.error('ip address "' + dev.devIpAddr + '" has invalid format, please correct configuration.');
            ok = false;
        }

        if (!/^\d+$/.test(dev.devTimeout)) {
            adapter.log.error('device "' + dev.devName + '" - timeout (' + dev.devTimeout + ') must be numeric, please correct configuration.');
            ok = false;
        }
        dev.devTimeout = parseInt(dev.devTimeout, 10) || 5;
        if (dev.devTimeout > 600) { // must be less than 0x7fffffff / 1000
            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be less than 600 seconds, please correct configuration.');
            dev.devTimeout = 600;
            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 600 seconds.');
        }
        if (dev.devTimeout < 1) {
            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be at least 1 second, please correct configuration.');
            dev.devTimeout = 1;
            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 1 second.');
        }

        if (!/^\d+$/.test(dev.devPollIntvl)) {
            adapter.log.error('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be numeric, please correct configuration.');
            ok = false;
        }
        dev.devPollIntvl = parseInt(dev.devPollIntvl, 10) || 30;
        if (dev.devPollIntvl > 3600) { // must be less than 0x7fffffff / 1000
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be less than 3600 seconds, please correct configuration.');
            dev.devPollIntvl = 3600;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 3600 seconds.');
        }
        if (dev.devPollIntvl < 5) {
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be at least 5 seconds, please correct configuration.');
            dev.devPollIntvl = 5;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 5 seconds.');
        }
        if (dev.devPollIntvl <= dev.devTimeout) {
            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be larger than device timeout (' + dev.devTimeout + '), please correct configuration.');
            dev.devPollIntvl = dev.devTimeout + 1;
            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to ' + dev.devPollIntvl + ' seconds.');
        }
    }

    if (!ok) {
        adapter.log.debug('validateConfig - validation aborted (checks failed)');
        return false;
    }

    adapter.log.debug('validateConfig - validation completed (checks passed)');
    return true;
}

// #################### adapter main functions ####################

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: 'nsclient',

        // ready callback is called when databases are connected and adapter received configuration.
        ready: onReady, // Main method defined below for readability

        // unload callback is called when adapter shuts down - callback has to be called under any circumstances!
        unload: onUnload,

        // If you need to react to object changes, uncomment the following method.
        // You also need to subscribe to the objects with `adapter.subscribeObjects`, similar to `adapter.subscribeStates`.
        // objectChange: (id, obj) => {
        //     if (obj) {
        //         // The object was changed
        //         adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        //     } else {
        //         // The object was deleted
        //         adapter.log.info(`object ${id} deleted`);
        //     }
        // },

        // is called if a subscribed state changes
        //stateChange: (id, state) => {
        //    if (state) {
        //        // The state was changed
        //        adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        //    } else {
        //        // The state was deleted
        //        adapter.log.info(`state ${id} deleted`);
        //    }
        //},

        // message callback is called whenever some message was sent to this instance over message box.
        // message: onMessage,

    }));
}

/**
 * onReady - will be called as soon as adapter is ready
 *
 * @return
 *
 */
async function onReady() {

    adapter.log.debug('onReady triggered');

    // mark adapter as non active
    await adapter.setStateAsync('info.connection', false, true);

    // validate config
    if (!validateConfig()) {
        adapter.log.error('invalid config, cannot continue');
        adapter.disable();
        return;
    }

    // read global config

    // setup worker thread contices
    setupContices();

    // init base objects
    await initAllBaseObjects();

    adapter.log.debug('initialization completed');

    // start one reader thread per device
    startReaderThreads();

    // start connection info updater
    //    adapter.log.debug('startconnection info updater');
    //    g_connUpdateTimer = adapter.setInterval(handleConnectionInfo, 15000)

    // NOTE: info.connection should be handled better
    await adapter.setStateAsync('info.connection', true, true);

    adapter.log.debug('startup completed');

}

/**
 * onMessage - called when adapter receives a message
 *
 * @param   pObj     object  message object
 * @return
 *  *** reserved for future use ***
 */
//function onMessage (pObj) {
//    if (typeof pObj === 'object' && pObj.message) {
//        if (pObj.command === 'send') {
//            // e.g. send email or pushover or whatever
//            adapter.log.info('send command');
//
//            // Send response in callback if required
//            if (pObj.callback) adapter.sendTo(pObj.from, pObj.command, 'Message received', pObj.callback);
//        }
//    }
//}

/**
 * onUnload - called when adapter shuts down
 *
 * @param  callback 	callback function
 * @return
 *
 */
function onUnload(callback) {
    adapter.log.debug('onUnload triggered');

    for (let ii = 0; ii < CTXs.length; ii++) {
        const CTX = CTXs[ii];

        // (re)set device online status
        try {
            adapter.setState(CTX.id + '.online', false, true);
        } catch (e) { console.log(e); }

        // close session if one exists
        if (CTX.pollTimer) {
            try {
                adapter.clearInterval(CTX.pollTimer);
            } catch (e) { console.log(e); }
            CTX.pollTimer = null;
        }
    }

    //    if (g_connUpdateTimer) {
    //        try {
    //            adapter.clearInterval(g_connUpdateTimer);
    //        } catch { };
    //        g_connUpdateTimer = null;
    //    };

    //    try {
    //        adapter.setState('info.connection', false, true);
    //    } catch { };

    // callback must be called under all circumstances
    callback && callback();
}

/* ***** here we start ***** */

console.log('DEBUG  : nsclient++ adapter initializing (' + process.argv + ') ...'); //logger not yet initialized

// if (process.argv) {
//     for (let a = 1; a < process.argv.length; a++) {
//         if (process.argv[a] === '--install') {
//             doInstall = true;
//             process.on('exit', function () {
//                 if (!didInstall) {
//                     console.log('WARNING: migration of config skipped - ioBroker might be stopped');
//                 }
//             })
//         }
//     }
// }

if (require.main !== module) {
    // Export startAdapter in compact mode

    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}