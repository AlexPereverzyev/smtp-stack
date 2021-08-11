/* eslint-disable */

'use strict';

// https://github.com/medialize/URI.js/blob/gh-pages/src/IPv6.js
module.exports = function (address) {
    // based on:
    // Javascript to test an IPv6 address for proper format, and to
    // present the "best text representation" according to IETF Draft RFC at
    // http://tools.ietf.org/html/draft-ietf-6man-text-addr-representation-04
    // 8 Feb 2010 Rich Brown, Dartware, LLC
    // Please feel free to use this code as long as you provide a link to
    // http://www.intermapper.com
    // http://intermapper.com/support/tools/IPV6-Validator.aspx
    // http://download.dartware.com/thirdparty/ipv6validator.js

    const _address = address.toLowerCase();
    const segments = _address.split(':');
    let length = segments.length;
    let total = 8;

    // trim colons (:: or ::a:b:c… or …a:b:c::)
    if (segments[0] === '' && segments[1] === '' && segments[2] === '') {
        // must have been ::
        // remove first two items
        segments.shift();
        segments.shift();
    } else if (segments[0] === '' && segments[1] === '') {
        // must have been ::xxxx
        // remove the first item
        segments.shift();
    } else if (segments[length - 1] === '' && segments[length - 2] === '') {
        // must have been xxxx::
        segments.pop();
    }

    length = segments.length;

    // adjust total segments for IPv4 trailer
    if (segments[length - 1].indexOf('.') !== -1) {
        // found a "." which means IPv4
        total = 7;
    }

    // fill empty segments them with "0000"
    let pos;
    for (pos = 0; pos < length; pos++) {
        if (segments[pos] === '') {
            break;
        }
    }

    if (pos < total) {
        segments.splice(pos, 1, '0000');
        while (segments.length < total) {
            segments.splice(pos, 0, '0000');
        }

        length = segments.length;
    }

    // strip leading zeros
    let _segments;
    for (var i = 0; i < total; i++) {
        _segments = segments[i].split('');
        for (let j = 0; j < 3; j++) {
            if (_segments[0] === '0' && _segments.length > 1) {
                _segments.splice(0, 1);
            } else {
                break;
            }
        }

        segments[i] = _segments.join('');
    }

    // find longest sequence of zeroes and coalesce them into one segment
    let best = -1;
    let _best = 0;
    let _current = 0;
    let current = -1;
    let inzeroes = false;
    // i; already declared

    for (i = 0; i < total; i++) {
        if (inzeroes) {
            if (segments[i] === '0') {
                _current += 1;
            } else {
                inzeroes = false;
                if (_current > _best) {
                    best = current;
                    _best = _current;
                }
            }
        } else {
            if (segments[i] === '0') {
                inzeroes = true;
                current = i;
                _current = 1;
            }
        }
    }

    if (_current > _best) {
        best = current;
        _best = _current;
    }

    if (_best > 1) {
        segments.splice(best, _best, '');
    }

    length = segments.length;

    // assemble remaining segments
    let result = '';
    if (segments[0] === '') {
        result = ':';
    }

    for (i = 0; i < length; i++) {
        result += segments[i];
        if (i === length - 1) {
            break;
        }

        result += ':';
    }

    if (segments[length - 1] === '') {
        result += ':';
    }

    return result;
};
