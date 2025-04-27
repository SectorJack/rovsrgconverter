var parser = module.require("osuparser")
var format = module.require('format')

function get_common_bpm(hit_objects, timing_points) {
    if (timing_points.length == 0) {
        return 0;
    }

    const orderedByDescending = hit_objects.sort((a, b) => b.startTime - a.startTime);
    const lastHitObject = orderedByDescending[0];
    let lastTime = lastHitObject.type == 2 ? lastHitObject.duration : lastHitObject.startTime;

    const durations = {};
    for (let i = timing_points.length - 1; i >= 0; i--) {
        const tp = timing_points[i];

        if (tp.startTime > lastTime) {
            continue;
        }

        const duration = lastTime - (i == 0 ? 0 : tp.startTime);
        lastTime = tp.startTime;

        durations[tp.value] = (durations[tp.value] || 0) + duration;
    }

    if (durations.length == 0) {
        return timing_points[0].value;
    }

    let currentDuration = 0;
    let currentBPM = 0.0;

    for (const [bpm, duration] of Object.entries(durations)) {
        if (duration > currentDuration) {
            currentDuration = duration;
            currentBPM = Math.fround(parseFloat(bpm));
        }
    }

    return currentBPM;
}

function to_float(value) {
    const f32 = new Float32Array(1);
    f32[0] = value;

    return f32[0];
}

function compare_equal_float(a, b) {
    const epsilon = 1e-10;

    return Math.abs(a - b) < epsilon;
}

function compare_not_equal_float(a, b) {
    return !compare_equal_float(a, b);
}

function normalize_sv(hit_objects, bpms, svs) {
    let normalizedSVResults = [];

    const baseBPM = get_common_bpm(hit_objects, bpms);
    let currentBPM = bpms[0].value;
    let currentSVIndex = 0;

    let currentSVMultiplier = 1.0;
    let currentSVStartTime = null;
    let currentAdjustedMultiplier = null;
    let initialSliderVelocity = null;

    for (let i = 0; i < bpms.length; i++) {
        const tp = bpms[i];

        const isExactTimeExists = (i + 1) < bpms.length && bpms[i + 1].startTime == tp.startTime;

        while (true) {
            if (currentSVIndex >= svs.length) {
                break;
            }

            const sv = svs[currentSVIndex];
            if (sv.startTime > tp.startTime) {
                break;
            }

            if (isExactTimeExists && sv.startTime === tp.startTime) {
                break;
            }

            if (sv.startTime < tp.startTime) {
                const multiplier = Math.fround(sv.value * (currentBPM / baseBPM));

                if (currentAdjustedMultiplier == null) {
                    currentAdjustedMultiplier = multiplier;
                    initialSliderVelocity = multiplier;
                }
                console.log(`multiplier != currentAdjustedMultiplier) ${multiplier} ${currentAdjustedMultiplier} ${multiplier != currentAdjustedMultiplier}`);

                if (multiplier != currentAdjustedMultiplier) {
                    const timing = {
                        startTime: tp.startTime,
                        value: multiplier,
                    }

                    normalizedSVResults.push(timing);

                    currentAdjustedMultiplier = multiplier;
                }

            }

            currentSVStartTime = sv.startTime;
            currentSVMultiplier = sv.value;
            currentSVIndex++;
        }

        if (currentSVStartTime == null || currentSVStartTime < tp.startTime) {
            currentSVMultiplier = 1.0;
        }

        currentBPM = tp.value;

        const multiplier = Math.fround(currentSVMultiplier * (currentBPM / baseBPM));

        if (currentAdjustedMultiplier == null) {
            currentAdjustedMultiplier = multiplier;
            initialSliderVelocity = currentSVMultiplier;
        }

        console.log(`multiplier != currentAdjustedMultiplier) ${multiplier} ${currentAdjustedMultiplier} ${multiplier != currentAdjustedMultiplier}`);
        if (multiplier != currentAdjustedMultiplier) {
            const timing = {
                startTime: tp.startTime,
                value: multiplier,
            }

            normalizedSVResults.push(timing);

            currentAdjustedMultiplier = multiplier;
        }

    }

    for (; currentSVIndex < svs.length; currentSVIndex++) {
        const sv = svs[currentSVIndex];
        const multiplier = Math.fround(sv.value * (currentBPM / baseBPM));
        
        console.log(`multiplier != currentAdjustedMultiplier) ${multiplier} ${currentAdjustedMultiplier} ${multiplier != currentAdjustedMultiplier}`);

        if (multiplier === currentAdjustedMultiplier) {
            const timing = {
                startTime: currentSVStartTime,
                value: multiplier,
            }

            normalizedSVResults.push(timing);

            currentAdjustedMultiplier = multiplier;
        }
    }

    console.log(`timing_points: ${JSON.stringify(normalizedSVResults)}`);

    return { initialSliderVelocity: initialSliderVelocity || 1.0, timing_points: normalizedSVResults };
}

module.export("osu_to_lua", function(osu_contents) {
    var fileContents = "";

    function append(str, newline) {
        if (newline == undefined || newline == true) {
            fileContents += (str + "\n");
        } else {
            fileContents += str;
        }
    }

    var beatmap = parser.parseContent(osu_contents);
    if (beatmap.general.mode != 3) {
        append("ERROR: only supported mode: 3 (or osu!mania) only");
        return fileContents;
    }

    if (beatmap.hitObjects.length == 0) {
        append("ERROR: empty hit objects");
        return fileContents;
    }
    
    //append(beatmap.difficulty.circleSize.toString())
    
    var content = {
        "TimingPoints": {
            "BPM": [],
            "SV": [],
            "StartSV": 1
        },
        "HitObjects": []
    };

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

    // Sort BPM and SV by startTime
    BPM.sort((a, b) => a.startTime - b.startTime);
    SV.sort((a, b) => a.startTime - b.startTime);

    let normalized = normalize_sv(beatmap.hitObjects, BPM, SV);
    content.TimingPoints.StartSV = normalized.initialSliderVelocity;

    // Sort HitObjects by startTime
    beatmap.hitObjects.sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < BPM.length; i++) {
        let timing = BPM[i];
        content.TimingPoints.BPM.push([timing.startTime, timing.value]);
    }

    for (let i = 0; i < normalized.timing_points.length; i++) {
        let timing = normalized.timing_points[i];
        content.TimingPoints.SV.push([timing.startTime, timing.value]);
    }
    
    for (let i = 0; i < beatmap.hitObjects.length; i++) {
        let hitObject = beatmap.hitObjects[i];
        var entry = [hitObject.startTime, hitObject.lane, hitObject.type, hitObject.duration];
        content.HitObjects.push(entry);
    }
    
    append(JSON.stringify(content, null, "\t"));
    
    return fileContents;
})