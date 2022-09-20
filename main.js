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
 *      name       string   name of the device
 *      ipAddr     string   ip address (without port number)
 *      ipPort     number   ip port number
 *      id         string   id of device, dereived from ip address or from name
 *      isIPv6     bool     true if IPv6 to be used
 *      timeout    number   snmp connect timeout (ms)
 *      retryIntvl number   snmp retry intervall (ms)
 *      pollIntvl  number   snmp poll intervall (ms)
 *      snmpVers   number   snmp version
 *      community  string   snmp comunity (v1, v2c)
 *      chunks     array    array of oid data consiting of
 *      {
 *          OIDs       array of objects
 *                          oid config object (contains i.e. flags)
 *          oids       array of strings
 *                          oids to be read
 *          ids        array of strings
 *                          ids for oids to be read
 *      }
 *      pollTimer  object   timer object for poll timer
 *      retryTimer object   timer object for retry timer
 *      session    object   snmp session object
 *      inactive   bool     flag indicating conection status of device
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
 * @param   {string}    pName   state name
 * @param   {string}    pRole   role of state
 * @param   {string}    pType   type of state
 * @param   {any}       pValue  new value the of the state
 * @param   {number}    pQual   quality code of the state
 * @return  nothing
 *
 */
const MODE_RD = 0;
const MODE_WR = 1;
const MODE_RW = 2;
async function updateState(pId, pName, pType, pRole, pMode, pValue, pQual) {
    adapter.log.debug('updateState - ' + pId);

    if ( ! STATEs[pId] ) {
        await initObject({
            _id: pId,
            type: 'state',
            common: {
                name: pName,
                write: pMode === MODE_WR || pMode === MODE_RW,
                read: pMode === MODE_RD || pMode === MODE_RW,
                type: pType,
                role: pRole
            },
            native: {
            }
        });
        STATEs[pId] = {};
        STATEs[pId].type = pType;
    }

    if ( STATEs[pId].type !== pType ){
        await initObject({
            _id: pId,
            type: 'state',
            common: {
                name: pName,
                write: pMode === MODE_WR || pMode === MODE_RW,
                read: pMode === MODE_RD || pMode === MODE_RW,
                type: pType,
                role: pRole
            },
            native: {
            }
        });
        STATEs[pId].type = pType;
    }

    await adapter.setStateAsync(pId, {val: pValue, ack: true, q:pQual} );
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
    await updateState(pCTX.id + '.online', pCTX.name + ' online',
        'boolean', 'indicator.reachable', MODE_RD, false, 0);
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
    await updateState(pCTX.id+'.info.name',    'client name',    'string', 'info.name',    MODE_RD, pJdata.name,    0);
    await updateState(pCTX.id+'.info.version', 'client version', 'string', 'info.version', MODE_RD, pJdata.version, 0);

}

/**
 * parseInfo - parse the json returned by any command with perf data (check_cpu, check_memory, check_drives)
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
    await updateState(baseId + '.result', 'result', 'number', 'value.severity', MODE_RD, pJdata.result, 0);

    // TODO: for each line ???
    await updateState(baseId + '.message', 'message', 'string', 'text', MODE_RD, pJdata.lines[0].message, 0);

    await initFolderObject (baseId + '.perf', '');
    for(const perfKey in pJdata.lines[0].perf){
        const perfId = name2id (baseId + '.perf' + '.' + perfKey);
        await initFolderObject (perfId, '');
        for(const state in pJdata.lines[0].perf[perfKey]){
            const stateId = name2id (baseId + '.perf' + '.' + perfKey + '.' + state);
            const stateVal = pJdata.lines[0].perf[perfKey][state];
            const isNum = /^\d+(\.\d+)?$/.test(stateVal);
            await updateState(stateId, 'state', isNum?'number':'string', 'value', MODE_RD, stateVal, 0);
        }
    }
}

// #################### network functions ####################
async function httpsGetAsync( pUrl ){
    adapter.log.debug('httpsGetAsync - ' + pUrl );
    const ret= {};
    ret.httpCode=0;
    ret.errCode=0;
    ret.errText='';
    ret.data='';

    return new Promise((resolve,_reject)=>{
        const options= {
            rejectUnauthorized: false
        };
        https.get( pUrl, options, (res) => {
            console.log('statusCode:', res.statusCode);
            ret.httpCode = res.statusCode||0;
            // console.log('headers:', res.headers);

            res.on('data', (d) => {
                console.log('at on');
                console.log(d.toString());
                ret.data=d;
                resolve(ret);
            });
        }).on('error', (e) => {
            // @ts-ignore
            if ( e && e.code !== 'HPE_INVALID_CONSTANT' )
            {
                console.error(e);
                // @ts-ignore
                ret.errCode = e.code;
                ret.errText = e.toString();
                resolve(ret);
            }
        });
    });
}

async function executeQuery ( pUrl, pQueryName) {

    adapter.log.debug('executeQuery - ' + pQueryName );

    const url = pUrl + QUERIES [ pQueryName ].query;
    const ret = await httpsGetAsync( url );
    if ( ret.errCode ) {
        console.log ('Error: [' + ret.errCode + '] ' + ret.errText );
    }
    else if (ret.httpCode !== 200) {
        console.log ('Error: http Code ' + ret.httpCode );
    } else {
        console.log (ret.data.toString());
        return ret.data;
    }
}


// #################### scanning functions ####################
async function processQuery ( pCTX, pQuery ){
    const name = pCTX.name;
    let jdata;
    adapter.log.debug('[' + name + '] processQuery starting for index ' + pQuery);

    const data = await executeQuery( pCTX.url, pQuery );
    if ( data && data !== '') {
        jdata = JSON.parse( data );
    }
    return jdata;
}

/**
 * scanDevice - scan a single device
 *
 * @param   pCTX    context of a single device
 * @return
 *
 */
async function scanDevice ( pCTX ){
    const name = pCTX.name;
    adapter.log.debug('[' + name + '] scanDevice starting');

    if (pCTX.busy){
        adapter.warn('[' + name + '] device is still busy - scan interval should be reduced').
            return;
    }
    pCTX.busy = true;

    if ( ! pCTX.initialized )
    {
        const jdata = await processQuery( pCTX, 'info' );
        QUERIES['info'].parser( pCTX, jdata );
    }

    //TODO: 
    // set initialized
    // handle offline incl. warning
    // handle error returned by query
    
    let jdata;
    jdata = await processQuery( pCTX, 'check_memory' );
    QUERIES['check_memory'].parser( pCTX, jdata );

    jdata = await processQuery( pCTX, 'check_cpu' );
    QUERIES['check_cpu'].parser( pCTX, jdata );

    //    for (let ii = 0; ii < pCTX.queries.length; ii++) {
    //        adapter.log.debug('[' + id + '] processing query index ' + ii );
    //        await processQuery( pCTX, ii );
    //        adapter.log.debug('[' + id + '] processing query index ' + ii + ' completed' );
    //    }

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
        CTX.pollTimer = setInterval(scanDevice, CTX.pollIntvl, CTX);
    }
}

/**
 * setupContices - setup contices for worker threads
 *
 * @return  nothing
 *
 *	CTX		object containing data for one device
 *			it has the following attributes
 *		ip			string 	ip address of target device
 *		ipStr		string	ip address of target device with invalid chars removed
 *		OIDs		array of OID objects
 *		oids		array of oid strings (used for snmp call)
 *		ids			array of id strings (index syncet o oids array)
 * 		authId 	    string 	snmp community (snmp V1, V2 only)
 *		initialized	boolean	true if connection is initialized
 *		inactive	boolean	true if connection to device is active
 */
function setupContices() {
    adapter.log.debug('setupContices - initializing contices');

    for (let ii = 0, jj = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) {
            continue;
        }

        adapter.log.debug('adding device "' + dev.devIpAddr + '" (' + dev.devName + ')' );
        adapter.log.debug('timing parameter: polling ' + dev.devPollIntvl + 's');

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
        CTXs[jj].pollIntvl = (dev.devPollIntvl||1) * 1000;   //s -> ms must be less than 0x7fffffff

        CTXs[jj].chkCpu = (dev.devChkCpu || false );
        CTXs[jj].chkMem = (dev.devChkMem || false );
        CTXs[jj].chkDrives = (dev.devChkDrives || false );

        CTXs[jj].url = 'https://' + CTXs[jj].user + ':' + CTXs[jj].pwd + '@'+CTXs[jj].ipAddr + ':' + CTXs[jj].ipPort;

        CTXs[jj].busy = false;
        CTXs[jj].initialized = false;
        CTXs[jj].connected = false;

        CTXs[jj].queries = [];

        CTXs[jj].pollTimer = null;  // poll intervall timer
        CTXs[jj].inactive = true;   // connection status of device

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

    adapter.log.debug('validateConfig - verifying oid-sets');

    // ensure that at least empty config exists
    adapter.config.devs = adapter.config.devs || [];

    adapter.log.debug('validateConfig - verifying devices');

    if (!adapter.config.devs.length) {
        adapter.log.error('no devices configured, please add configuration.');
        ok = false;
    }

    for (let ii = 0; ii < adapter.config.devs.length; ii++) {
        const dev = adapter.config.devs[ii];

        if (!dev.devAct) continue;

        dev.devName = (dev.devName||'').trim();
        dev.devIpAddr = (dev.devIpAddr||'').trim();

        // IP addr might be an IPv4 address, and IPv6 address or a dsn name
        if (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(dev.devIpAddr)) {
            /* ipv4 - to be checked further */
        } else if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(dev.devIpAddr)) {
            /* domain name */
        } else {
            adapter.log.error('ip address "' + dev.devIpAddr + '" has invalid format, please correct configuration.');
            ok = false;
        }

        //        if (!/^\d+$/.test(dev.devTimeout)) {
        //            adapter.log.error('device "' + dev.devName + '" - timeout (' + dev.devTimeout + ') must be numeric, please correct configuration.');
        //            ok = false;
        //        }
        //        dev.devTimeout = parseInt(dev.devTimeout, 10) || 5;
        //        if (dev.devTimeout > 600) { // must be less than 0x7fffffff / 1000
        //            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be less than 600 seconds, please correct configuration.');
        //            dev.devTimeout = 600;
        //            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 600 seconds.');
        //        }
        //        if (dev.devTimeout < 1) {
        //            adapter.log.warn('device "' + dev.devName + '" - device timeout (' + dev.devTimeout + ') must be at least 1 second, please correct configuration.');
        //            dev.devTimeout = 1;
        //            adapter.log.warn('device "' + dev.devName + '" - device timeout set to 1 second.');
        //        }

        //        if (!/^\d+$/.test(dev.devPollIntvl)) {
        //            adapter.log.error('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be numeric, please correct configuration.');
        //            ok = false;
        //        }
        //        dev.devPollIntvl = parseInt(dev.devPollIntvl, 10) || 30;
        //        if (dev.devPollIntvl > 3600) { // must be less than 0x7fffffff / 1000
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be less than 3600 seconds, please correct configuration.');
        //            dev.devPollIntvl = 3600;
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 3600 seconds.');
        //        }
        //        if (dev.devPollIntvl < 5) {
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be at least 5 seconds, please correct configuration.');
        //            dev.devPollIntvl = 5;
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to 5 seconds.');
        //        }
        //        if (dev.devPollIntvl <= dev.devTimeout) {
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall (' + dev.devPollIntvl + ') must be larger than device timeout (' + dev.devTimeout + '), please correct configuration.');
        //            dev.devPollIntvl = dev.devTimeout + 1;
        //            adapter.log.warn('device "' + dev.devName + '" - poll intervall set to ' + dev.devPollIntvl + ' seconds.');
        //        }
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
        message: onMessage,

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

    /*
    https.get('https://admin:nagios57@localhost:8443/api/v1/info', {rejectUnauthorized: false}, (res) => {
        console.log('statusCode:', res.statusCode);
        //        console.log('headers:', res.headers);

        res.on('data', (d) => {
            process.stdout.write(d);
        });

    }).on('error', (e) => {
        //        console.error(e);
    });
*/
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
    //    g_connUpdateTimer = setInterval(handleConnectionInfo, 15000)

    adapter.log.debug('startup completed');

}

/**
 * onMessage - called when adapter receives a message
 *
 * @param   pObj     object  message object
 * @return
 *
 */
function onMessage (pObj) {
    if (typeof pObj === 'object' && pObj.message) {
        if (pObj.command === 'send') {
            // e.g. send email or pushover or whatever
            adapter.log.info('send command');

            // Send response in callback if required
            if (pObj.callback) adapter.sendTo(pObj.from, pObj.command, 'Message received', pObj.callback);
        }
    }
}

/**
 * onUnload - called when adapter shuts down
 *
 * @param  callback 	callback function
 * @return
 *
 */
function onUnload(callback) {
    adapter.log.debug('onUnload triggered');

    //    for (let ii = 0; ii < CTXs.length; ii++) {
    //        const CTX = CTXs[ii];

    //        // (re)set device online status
    //        try {
    //            adapter.setState(CTX.id + '.online', false, true);
    //        } catch { };

    //        // close session if one exists
    //        if (CTX.pollTimer) {
    //            try {
    //                clearInterval(CTX.pollTimer);
    //            } catch { };
    //            CTX.pollTimer = null;
    //        };

    //        if (CTX.session) {
    //            try {
    //                CTX.session.on('error', null); // avoid nesting callbacks
    //                CTX.session.on('close', null); // avoid nesting callbacks
    //                CTX.session.close();
    //            } catch { }
    //            CTX.session = null;
    //        }
    //    };

    //    if (g_connUpdateTimer) {
    //        try {
    //            clearInterval(g_connUpdateTimer);
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

console.log('DEBUG  : snmp adapter initializing (' + process.argv + ') ...'); //logger not yet initialized

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