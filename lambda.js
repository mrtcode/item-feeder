/*
 ***** BEGIN LICENSE BLOCK *****
 
 This file is part of the Zotero Data Server.
 
 Copyright © 2018 Center for History and New Media
 George Mason University, Fairfax, Virginia, USA
 http://zotero.org
 
 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 
 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Affero General Public License for more details.
 
 You should have received a copy of the GNU Affero General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 
 ***** END LICENSE BLOCK *****
 */

const elasticsearch = require('elasticsearch');

const es = new elasticsearch.Client({
	hosts: process.env.ES_HOSTS.split(','),
	requestTimeout: 30 * 1000
});

async function delay(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	})
}

exports.handler = async function (event) {
	try {
		let bulk = [];
		
		for (let record of event.Records) {
			let message = JSON.parse(record.body);
			
			if (message.action === 'add' || message.action === 'modify') {
				bulk.push({
					index: {
						_index: process.env.ES_INDEX,
						_type: process.env.ES_TYPE,
						_id: message.id,
						_version: message.version,
						// The existing item must have a lower version number,
						// or shouldn't exist at all
						_version_type: 'external_gt'
					}
				});
				bulk.push(message.item);
			}
			else if (message.action === 'delete') {
				bulk.push({
					index: {
						_index: process.env.ES_INDEX,
						_type: process.env.ES_TYPE,
						_id: message.id,
						_version: message.version,
						// The existing item must have a lower or equal version number,
						// or shouldn't exist at all
						_version_type: 'external_gte'
					}
				});
				bulk.push({
					documentDeleted: true,
					documentDeletionTime: (new Date()).toISOString()
				});
			}
		}
		
		let result = await es.bulk({body: bulk});
		if (result.errors) {
			for (let item of result.items) {
				item = item.index || item.delete;
				// Ignore 'version_conflict_engine_exception' and 'not_found' errors
				if (!item.error || [409, 404].includes(item.status)) {
					continue;
				}
				throw new Error('Errors in bulk request. Result: ' + JSON.stringify(result));
			}
		}
	}
	catch (err) {
		console.log(event);
		console.log(err);
		// Script exit on error delay is controlled with Lambda timeout,
		// which is also equal to SQS visibility timeout
		// (it's not allowed to set it lower than Lambda timeout).
		// This allows to better align Lambda exit on error delay and
		// SQS visibility time of the taken messages
		await delay(99999999);
	}
};
