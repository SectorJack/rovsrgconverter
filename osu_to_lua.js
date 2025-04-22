var parser = module.require("osuparser")
var format = module.require('format')

function get_common_bpm(hit_objects, timing_points) {
    if (timing_points.length == 0) {
        return 0;
    }

    let durations = {};

    let lastHitObject = hit_objects[hit_objects.length - 1];
    let lastTime = lastHitObject.type == 2 ? lastHitObject.endTime : lastHitObject.startTime;

    let index = timing_points.length - 1;
    while (true) {
        if (index >= 0) {
            let point = timing_points[index];

            if (point.startTime > lastTime) {
                index -= 1;
                continue;
            }

            let duration = lastTime - (index == 0 ? 0 : point.startTime);
            lastTime = point.startTime;

            let tp_exist = durations[point.value];
            if (tp_exist) {
                durations[point.value] += duration;
            } else {
                durations[point.value] = duration;
            }
        } else {
            break;
        }

        index -= 1;
    }

    let sortedDurations = Object.entries(durations).sort((a, b) => b[1] - a[1]);

    if (sortedDurations.length == 0) {
        return 0;
    }

    let result = sortedDurations[0][0];
    if (result == 0) {
        console.warn("BREAK");
    }

    return parseFloat(result);
}

function normalize_sv(hit_objects, bpms, svs) {
    let normalizedSVResults = [];
    let baseBPM = get_common_bpm(hit_objects, bpms);

    let currentBPM = bpms[0].value;
    let currentSvIndex = 0;

    let currentSVStartTime = null;
    let currentSVMultiplier = 1;
    let currentAdjustedMultiplier = null;
    let initialSVMultiplier = null;

    for (let i = 0; i < bpms.length; i++) {
        let timing = bpms[i];
        let nextTimingHasSameTimestamp = false;
        if ((i + 1) < bpms.length && bpms[i + 1].startTime == timing.startTime) {
            nextTimingHasSameTimestamp = true;
        }

        while (true) {
            if (currentSvIndex >= svs.length) {
                break;
            }

            let sv = svs[currentSvIndex];
            if (sv.startTime > timing.startTime) {
                break;
            }

            if (nextTimingHasSameTimestamp && sv.startTime == timing.startTime) {
                break;
            }

            if (sv.startTime < timing.startTime) {
                let multiplier = sv.value * (currentBPM / baseBPM);
                if (currentAdjustedMultiplier == null) {
                    currentAdjustedMultiplier = multiplier;
                    initialSVMultiplier = multiplier;
                }

                if (multiplier != currentAdjustedMultiplier) {
                    normalizedSVResults.push({
                        startTime: sv.startTime,
                        value: multiplier
                    });

                    currentAdjustedMultiplier = multiplier;
                }
            }

            currentSVStartTime = sv.startTime;
            currentSVMultiplier = sv.value;
            currentSvIndex += 1;
        }

        if (currentSVStartTime == null || currentSVStartTime < timing.startTime) {
            currentSVMultiplier = 1;
        }

        currentBPM = timing.value;

        let multiplier1 = currentSVMultiplier * (currentBPM / baseBPM);

        if (currentAdjustedMultiplier == null) {
            currentAdjustedMultiplier = multiplier1;
            initialSVMultiplier = multiplier1;
        }

        if (multiplier1 != currentAdjustedMultiplier) {
            normalizedSVResults.push({
                startTime: timing.startTime,
                value: multiplier1
            });
    
            currentAdjustedMultiplier = multiplier1;
        }
    }

    while (currentSvIndex < svs.length) {
        let sv = svs[currentSvIndex];
        let multiplier = sv.value * (currentBPM / baseBPM);

        if (currentAdjustedMultiplier == null) {
            throw new Error("currentAdjustedMultiplier:null != null");
        }

        if (multiplier != currentAdjustedMultiplier) {
            normalizedSVResults.push({
                startTime: sv.startTime,
                value: multiplier
            });

            currentAdjustedMultiplier = multiplier;
        }

        currentSvIndex += 1;
    }

    let initialSliderVelocity = initialSVMultiplier || 1;
    svs = normalizedSVResults;

    return { initialSliderVelocity, timing_points: svs };
}

module.export("osu_to_lua", function(osu_contents) {
    var fileContents = ""

    function append(str, newline) {
        if (newline == undefined || newline == true) {
            fileContents += (str + "\n")
        } else {
            fileContents += str
        }
    }

    var beatmap = parser.parseContent(osu_contents)
    if (beatmap.general.mode != 3) {
        append("ERROR: only supported mode: 3 (or osu!mania) only")
        return fileContents
    }

    if (beatmap.hitObjects.length == 0) {
        append("ERROR: empty hit objects")
        return fileContents
    }
    
    //append(beatmap.difficulty.circleSize.toString())
	
	var content = {
		"TimingPoints": {
			"BPM": [],
			"SV": [],
            "StartSV": 1
		},
		"HitObjects": []
	}

    let BPM = [];
    let SV = [];

    for (let i = 0; i < beatmap.timingPoints.length; i++) {
        let timing = beatmap.timingPoints[i];
        let sv = timing.uninherited == 0 || timing.value < 0;

        if (!sv) {
            BPM.push({
                startTime: timing.startTime,
                value: 60000 / timing.value,
            });
        } else {
            function clamp(min, max, value) {
                return Math.min(max, Math.max(min, value));
            }

            SV.push({
                startTime: timing.startTime,
                value: clamp(0.1, 10, -100 / timing.value),
            });
        }
    }

    let normalized = normalize_sv(beatmap.hitObjects, BPM, SV);
    content.TimingPoints.StartSV = normalized.initialSliderVelocity

    for (let i = 0; i < BPM.length; i++) {
        let timing = BPM[i];
        content.TimingPoints.BPM.push([timing.startTime, timing.value])
    }

    for (let i = 0; i < normalized.timing_points.length; i++) {
        let timing = normalized.timing_points[i];
        content.TimingPoints.SV.push([timing.startTime, timing.value])
    }
	
    for (let i = 0; i < beatmap.hitObjects.length; i++) {
        let hitObject = beatmap.hitObjects[i]
		var entry = [hitObject.startTime, hitObject.lane, hitObject.type, hitObject.duration]
		content.HitObjects.push(entry)
	}
	
	append(JSON.stringify(content, null, "\t"))
	
    return fileContents
})