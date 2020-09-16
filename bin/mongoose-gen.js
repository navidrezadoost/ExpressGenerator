
const program = require('commander');
const readline = require('readline');
const async = require('async');
const generators = require('../lib/generators');
const cliStyles = require('../lib/cliStyles');

const pkg = require('../package.json');
const version = pkg.version;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ALLOWED_FIELDS_TYPES = ['string', 'number', 'date', 'boolean', 'array', 'objectId'];
const ALLOWED_REST_ARGUMENT = { 'YES': 'yes', 'NO': 'no' };
const ALLOWED_FILE_TREE_ARGUMENT = { 'TYPE': 't', 'MODULE': 'm' };
const CLI_PHRASES = {
    AVAILABLE_TYPE: 'Available types : string, number, date, boolean, array, objectId',
    QUESTION_MODEL_NAME: 'Model Name : ',
    QUESTION_FIELD_NAME: 'Field Name (press <return> to stop adding fields) : ',
    QUESTION_FIELD_TYPE: 'Field Type [string] : ',
    QUESTION_FIELD_REF: 'Reference (model name referred by the objectId field) : ',
    QUESTION_GENERATE_REST: 'Generate Rest (yes/no) ? [yes] : ',
    QUESTION_FILES_TREE: 'Files tree generation grouped by Type or by Module (t/m) ? [t] : ',
    ERROR_MODEL_NAME: 'Argument required : Model name',
    ERROR_TYPE_ARGUMENT: 'Invalid Argument : Field type is not allowed',
    ERROR_REST_ARGUMENT: 'Argument invalid : rest',
    ERROR_FILES_TREE_ARGUMENT: 'Argument invalid : file tree generation',
    ERROR_FIELD_REQUIRED: 'Argument required : fields',
    ERROR_FIELD_NAME_REQUIRED: 'Argument required : Field Name',
    ERROR_FIELD_TYPE_REQUIRED: 'Argument required : Field type',
    ERROR_FIELD_TYPE_INVALID: 'Invalid Argument : Field type is not allowed'
};

// CLI
program
    .version(version)
    .usage('[options]')
    .option('-m, --model <modelName>', 'model name')
    .option('-f, --fields <fields>', 'model fields (name1:type1,name2:type2)')
    .option('-r, --rest', 'enable generation REST')
    .option('-t, --tree <tree>', 'files tree generation grouped by <t>ype or by <m>odule')
    .option('--ts', 'Generating code in TS')
    .parse(process.argv);

// Main program
((path) => {
    let ts = !!(program.ts);

    if (program.model || program.fields) {
        runNonInteractiveMode(path, ts);
    } else {
        runInteractiveMode(path, ts);
    }
})('.');


function runInteractiveMode(path, ts) {
    async.series({
            name: (cb) => {
                askQuestion(CLI_PHRASES.QUESTION_MODEL_NAME, isModelNameParamValid, (name) => {
                    console.log(cliStyles.green + CLI_PHRASES.AVAILABLE_TYPE + cliStyles.reset);
                    cb(null, name);
                });
            },
            fields: function(cb) {
                let exit = false;
                let fields = [];
                let currentField = {};

                async.whilst(
                    () => { return !exit; },
                    (cb) => {
                        async.series({
                                name: (cb) => {
                                    askQuestion(CLI_PHRASES.QUESTION_FIELD_NAME,
                                        null,
                                        (fieldName) => {
                                            if (fieldName.trim().length === 0) {
                                                exit = true;
                                            }
                                            cb(exit, fieldName);
                                        }
                                    );
                                },
                                type: (cb) => {
                                    askQuestion(CLI_PHRASES.QUESTION_FIELD_TYPE, isFieldTypeParamValid,
                                        (fieldType) => {
                                            currentField.type = (fieldType.trim().length === 0) ? 'string' : fieldType;
                                            cb(null, currentField.type);
                                        }
                                    );
                                },
                                reference: (cb) => {
                                    if (currentField.type === 'objectId') {
                                        askQuestion(CLI_PHRASES.QUESTION_FIELD_REF, null, (referenceName) => {
                                            referenceName = (referenceName.trim().length === 0) ?
                                                'INSERT_YOUR_REFERENCE_NAME_HERE' :
                                                referenceName;
                                            cb(null, referenceName);
                                        });
                                    } else {
                                        cb(null, null);
                                    }
                                }
                            },
                            (err, results) => {
                                if (!err) {
                                    fields.push(results);
                                }
                                cb();
                            });
                    },
                    (err, results) => {
                        cb(null, fields);
                    });
            },
            rest: (cb) => {
                askQuestion(CLI_PHRASES.QUESTION_GENERATE_REST, isRestParamValid, (rest) => {
                    rest = (rest.trim().length === 0) ? 'yes' : rest;
                    cb(null, rest);
                });
            },
            generateMethod: (cb) => {
                askQuestion(CLI_PHRASES.QUESTION_FILES_TREE, isFileTreeParamValid, (generateMethod) => {
                    generateMethod = (generateMethod.trim().length === 0) ? 't' : generateMethod;
                    cb(null, generateMethod);
                });
            }
        },
        (err, results) => {
            if (err) {
                return closeProgram();
            }

            async.parallel([
                    (cb) => {
                        generators.generateModel(path, results.name, results.fields, results.generateMethod, ts, cb);
                    },
                    (cb) => {
                        if (results.rest !== 'yes') { return cb(); }
                        generators.generateRouter(path, results.name, results.generateMethod, ts, cb);
                    },
                    (cb) => {
                        if (results.rest !== 'yes') { return cb(); }
                        generators.generateController(path, results.name, results.fields, results.generateMethod, ts, cb);
                    }
                ],
                (err, results) => {
                    closeProgram();
                }
            );
        }
    );
}


function runNonInteractiveMode(path, ts) {
    if (!isModelNameParamValid(program.model) || !isFieldsParamValid(program.fields)) {
        return closeProgram();
    }

    let modelName = program.model;
    let modelFields = formatFieldsParamInArray(program.fields);
    let fileTree = program.tree || ALLOWED_FILE_TREE_ARGUMENT.TYPE;

    if (!isFileTreeParamValid(fileTree)) {
        return closeProgram();
    }

    if (!modelFields) { return closeProgram(); }

    async.parallel([
            (cb) => {
                generators.generateModel(path, modelName, modelFields, fileTree, ts, cb);
            },
            (cb) => {
                if (!program.rest) { return cb(); }
                generators.generateRouter(path, modelName, fileTree, ts, cb);
            },
            (cb) => {
                if (!program.rest) { return cb(); }
                generators.generateController(path, modelName, modelFields, fileTree, ts, cb);
            }
        ],
        (err, results) => {
            closeProgram();
        }
    );
}


function askQuestion(question, validate, callback) {
    rl.question(question, function(answer) {
        if (validate) {
            if (!validate(answer)) {
                askQuestion(question, validate, callback);
                return;
            }
        }
        callback(answer);
    });
}


function closeProgram() {
    rl.close();
    process.exit();
}


function isModelNameParamValid(name) {
    if (!name || name.trim().length === 0) {
        consoleError(CLI_PHRASES.ERROR_MODEL_NAME);
        return false;
    }
    return true;
}


function isFieldTypeParamValid(fieldType) {
    if (!fieldType || fieldType.trim().length === 0) { fieldType = ALLOWED_FIELDS_TYPES[0]; } // default value
    if (ALLOWED_FIELDS_TYPES.indexOf(fieldType) === -1) {
        consoleError(CLI_PHRASES.ERROR_TYPE_ARGUMENT);
        return false;
    }
    return true;
}

/**
 * validate rest input
 * @param {string} param
 * @returns {boolean} is validated
 */
function isRestParamValid(param) {
    if (!param || param.trim().length === 0) { param = ALLOWED_REST_ARGUMENT.YES; } // default value
    if (param !== ALLOWED_REST_ARGUMENT.YES && param !== ALLOWED_REST_ARGUMENT.NO) {
        consoleError(CLI_PHRASES.ERROR_REST_ARGUMENT);
        return false;
    }
    return true;
}


function isFileTreeParamValid(param) {
    if (!param || param.trim().length === 0) { param = ALLOWED_FILE_TREE_ARGUMENT.TYPE; } // default value
    if (param !== ALLOWED_FILE_TREE_ARGUMENT.TYPE && param !== ALLOWED_FILE_TREE_ARGUMENT.MODULE) {
        consoleError(CLI_PHRASES.ERROR_FILES_TREE_ARGUMENT);
        return false;
    }
    return true;
}

/**
 * Validate fields input
 * @param {string} fields
 * @returns {boolean} is validated
 */
function isFieldsParamValid(fields) {
    if (!fields || fields.trim().length === 0) {
        consoleError(CLI_PHRASES.ERROR_FIELD_REQUIRED);
        return false;
    }
    return true;
}


function isFieldValid(fieldName, fieldType) {
    if (!fieldName || fieldName.trim().length === 0) {
        consoleError(CLI_PHRASES.ERROR_FIELD_NAME_REQUIRED);
        return false;
    }
    if (!fieldType || fieldType.trim().length === 0) {
        consoleError(CLI_PHRASES.ERROR_FIELD_TYPE_REQUIRED);
        return false;
    }
    if (ALLOWED_FIELDS_TYPES.indexOf(fieldType) === -1) {
        consoleError(CLI_PHRASES.ERROR_FIELD_TYPE_INVALID);
        return false;
    }
    return true;
}


function formatFieldsParamInArray(fields) {
    let arrayFields = fields.split(',');
    let result = [];

    let err = arrayFields.every((field) => {
        let f = field.split(':');

        let fieldName = f[0];
        let fieldType = (f[1] || ALLOWED_FIELDS_TYPES[0]);
        let fieldRef = '';
        let isArray = false;

        if (fieldType === ALLOWED_FIELDS_TYPES[5]) {
            fieldRef = f[2];
            isArray = f[3] === ALLOWED_FIELDS_TYPES[4];
        } else {
            isArray = f[2] === ALLOWED_FIELDS_TYPES[4];
        }

        if (!isFieldValid(fieldName, fieldType)) { return false; }

        result.push({
            name: fieldName,
            type: fieldType,
            isArray: isArray,
            reference: fieldRef
        });

        return true;
    });

    return (!err) ? false : result;
}

function consoleError(msg) {
    return console.log(cliStyles.red + msg + cliStyles.reset);
}