/*
 * Copyright 2016, Lorenzo Mangani (lorenzo.mangani@gmail.com)
 * Copyright 2015, Rao Chenlin (rao.chenlin@gmail.com)
 *
 * This file is part of KaaE (http://github.com/elasticfence/kaae)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const linkReqRespStats = function ($scope, config) {
  $scope.$bind('req', 'searchSource.history[searchSource.history.length - 1]');
  $scope.$watchMulti([
    'req',
    'req.started',
    'req.stopped',
    'searchSource'
  ], function () {
    if (!$scope.searchSource || !$scope.req) return;

    const req = $scope.req;
    const resp = $scope.req.resp;
    const stats = $scope.stats = [];
    const indices = $scope.index = [];

    if (resp && resp.took != null) stats.push(['Query Duration', resp.took + 'ms']);
    if (req && req.ms != null) stats.push(['Request Duration', req.ms + 'ms']);
    if (resp && resp.hits) stats.push(['Hits', resp.hits.total]);

    if (req.fetchParams) {
      // if (req.fetchParams.index) stats.push(['Index', req.fetchParams.index]);
      // if (req.fetchParams.type) stats.push(['Type', req.fetchParams.type]);
      // if (req.fetchParams.id) stats.push(['Id', req.fetchParams.id]);

      if (req.fetchParams.index) {
		var idx = (req.fetchParams.index).toString();
	        var tmp = idx.replace(/\*/g, '');
		indices.push("<"+tmp+"{now/d}>");
		indices.push("<"+tmp+"{now/d-1d}>");
      }
    }

    $scope.intervals = [
        { name: '1m', value: 'every 1 minute' }, 
        { name: '5m', value: 'every 5 minutes' }, 
        { name: '10m', value: 'every 10 minutes' }, 
        { name: '1h', value: 'every 1 hour' }
    ];

    $scope.ranges = [
        { name: '1m', value: 'now-1m' }, 
        { name: '5m', value: 'now-5m' }, 
        { name: '10m', value: 'now-1h' }, 
        { name: '1h', value: 'now-1h' },
        { name: '6h', value: 'now-6h' },
        { name: '12h', value: 'now-12h' },
        { name: '1d', value: 'now-1d' }
    ];

    $scope.resKeys = [];
    $scope.iterateKeys = function(data) {
 	   var result = {};
 	   function recurse (cur, prop) {
 	       if (Object(cur) !== cur) {
 	           result[prop] = cur;
 	       } else if (Array.isArray(cur)) {
 	            for(var i=0, l=cur.length; i<l; i++)
 	                recurse(cur[i], prop + "[" + i + "]");
 	           if (l == 0)
 	               result[prop] = [];
 	       } else {
 	           var isEmpty = true;
 	           for (var p in cur) {
 	               isEmpty = false;
 	               recurse(cur[p], prop ? prop+"."+p : p);
 	           }
 	           if (isEmpty && prop)
 	               result[prop] = {};
 	       }
 	   }
 	   recurse(data, "");
 	   $scope.resKeys = result;
    }

    if (resp) $scope.iterateKeys({payload:resp});


    /* Defaults */
    $scope.watcher_id = "new_saved";
    $scope.watcher_script = "payload.hits.total > 100";
    $scope.watcher_interval = $scope.intervals[0].value;
    $scope.watcher_range = $scope.ranges[1].value;

    $scope.watcher_email_to = "root@localhost";
    $scope.watcher_email_subj = "KAAE ALARM {{ payload._id }}";
    $scope.watcher_email_body = "Series Alarm {{ payload._id}}: {{ payload.hits.total }}";

    $scope.savedWatcher = {};
    var alarm = {};

    $scope.watcherUpdate = function(){
	    $scope.savedWatcher.interval = $scope.watcher_interval;
	    $scope.savedWatcher.range = $scope.watcher_range;
	    $scope.savedWatcher.id = $scope.watcher_id;
	    $scope.savedWatcher.script = $scope.watcher_script;
	    $scope.savedWatcher.keys = $scope.resKeys;
	    config.savedWatcher = $scope.savedWatcher;
    }
    
    $scope.makeAlarm = function(){
	// console.log('updainge proto watcher..');
	$scope.watcherUpdate();
        $scope.alarm = {
	  "_index": "watcher",
	  "_type": "watch",
	  "_id": $scope.watcher_id,
	  "_new": "true",
	  "_source": {
	    "trigger": {
	      "schedule": {
	        "later": $scope.watcher_interval ? $scope.watcher_interval : "every 5 minutes"
	      }
	    },
	    "input": {
	      "search": {
	        "request": {
	          "index": [],
	          "body": req.fetchParams.body,
	        }
	      }
	    },
	    "condition": {
	      "script": {
	        "script": $scope.savedWatcher.script
	      }
	    },
	    "transform": {},
	    "actions": {
	      "email_admin": {
	        "throttle_period": "15m",
	        "email": {
	          "to": $scope.watcher_email_to ? $scope.watcher_email_to : "alarm@localhost",
        	  "from": $scope.watcher_email_from ? $scope.watcher_email_from : "kaae@localhost",
	          "subject": $scope.watcher_email_subj ? $scope.watcher_email_subj : "Kaae Alarm",
	          "priority": "high",
	          "body": $scope.watcher_email_body ? $scope.watcher_email_body : "Found {{payload.hits.total}} Events"
	        }
	      }
	    }
	  }
	};

	// Patch Indices
	$scope.alarm._source.input.search.request.index = $scope.indices ? $scope.indices : [];
	// Patch Range
	$scope.alarm._source.input.search.request.body.query.filtered.filter = {"range": { "@timestamp": {"from": $scope.watcher_range ? $scope.watcher_range : "now-1h" } } };

	// Store Watcher
        alarm = $scope.alarm;
	window.localStorage.setItem('kaae_saved_query', JSON.stringify($scope.alarm));

    }

    $scope.makeAlarm();

  });
};



// Spy Placement
require('ui/registry/spy_modes').register(function () {
  return {
    display: 'Set Watcher',
    name: 'setalarm',
    order: 1000,
    link: linkReqRespStats,
    template: require('plugins/kaae/button/alarm_spy.html')
  };
});

