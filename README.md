![Logo](admin/nsclient.png)
# ioBroker.nsclient

[![NPM version](https://img.shields.io/npm/v/iobroker.nsclient.svg)](https://www.npmjs.com/package/iobroker.nsclient)
![Current version in stable repository](https://iobroker.live/badges/nsclient-stable.svg)
![Number of Installations](https://iobroker.live/badges/nsclient-installed.svg)

[![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.nsclient/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/nsclient/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.nsclient.svg)](https://www.npmjs.com/package/iobroker.nsclient)

[![NPM](https://nodei.co/npm/iobroker.nsclient.png?downloads=true)](https://nodei.co/npm/iobroker.nsclient/)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.**
For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## nsclient adapter for ioBroker

This adapter monitors remote systems using NSClient++ agent.

## General Requirements and Features

This adapter requires an NsClient++ agent to be installed at the target system, This agent is available for Windows (tested with Windows 10 and Windows 11) and Linux. The NsClient++ software is describes and available [here](https://nsclient.org/) free of charge.

This adapter allows automatic polling of client systems equipt with NsCleint++ agent and store the results at several states. So (for example) the following data is available within ioBroker:

- cpu load in percent for several time ranges
- memory load for several time ranges
- discspace with obsolute values and ar percentages

Additionally every check returns a binary status and a textual status message.

This adapter supports an unlimited number of devices with configurable polling interval.

## Restrictions

- Currently only https connectsions are supported. 
- user defined checks are not (yet) supported

## Documentation

[english documentation](https://github.com/iobroker-community-adapters/ioBroker.nsclient/tree/master/docs/en)
[deutsche Dokumentation](https://github.com/iobroker-community-adapters/ioBroker.nsclient/tree/master/docs/de)

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (mcm1957) This adapter requires node 18 or newer now
* (mcm1957) Dependencies have been updated

### 0.1.2 (2022-12-03)
* (mcm1957) missing config data has been added to io-package.json (#15)
* (mcm1957) timer functions have been replaced with iob adapter versions (#22)
* (mcm1957) support for sentry has been added (#23)

### 0.1.1 (2022-09-25)
* (mcm1957) initial release for testing

## License
MIT License

Copyright (c) 2022-2023 mcm1957 <mcm57@gmx.at>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
