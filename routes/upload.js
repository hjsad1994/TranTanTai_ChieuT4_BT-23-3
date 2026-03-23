var express = require("express");
var router = express.Router();
let { uploadImage, uploadExcel } = require('../utils/uploadHandler')
let path = require('path')
let excelJS = require('exceljs')
let fs = require('fs');
let crypto = require('crypto')
let productModel = require('../schemas/products')
let InventoryModel = require('../schemas/inventories')
let userModel = require('../schemas/users')
let roleModel = require('../schemas/roles')
let cartModel = require('../schemas/cart')
let userController = require('../controllers/users')
let mailHandler = require('../utils/sendMailHandler')
let mongoose = require('mongoose')
let slugify = require('slugify')

function removeUploadedFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
    }
}

function getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) {
        return ''
    }
    if (typeof cell.value === 'object') {
        if (Array.isArray(cell.value.richText)) {
            return cell.value.richText.map(function (item) {
                return item.text
            }).join('').trim()
        }
        if (cell.value.text) {
            return String(cell.value.text).trim()
        }
        if (cell.value.result) {
            return String(cell.value.result).trim()
        }
    }
    return String(cell.value).trim()
}

function isValidEmail(email) {
    return /^\S+@\S+\.\S+$/.test(email)
}

function pickRandomCharacter(characters) {
    return characters[crypto.randomInt(characters.length)]
}

function shuffleCharacters(characters) {
    for (let index = characters.length - 1; index > 0; index--) {
        let randomIndex = crypto.randomInt(index + 1)
        let temp = characters[index]
        characters[index] = characters[randomIndex]
        characters[randomIndex] = temp
    }
    return characters
}

function generateRandomPassword(length) {
    let lowercase = 'abcdefghijklmnopqrstuvwxyz'
    let uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let numbers = '0123456789'
    let symbols = '!@#$%^&*'
    let allCharacters = lowercase + uppercase + numbers + symbols
    let passwordCharacters = [
        pickRandomCharacter(lowercase),
        pickRandomCharacter(uppercase),
        pickRandomCharacter(numbers),
        pickRandomCharacter(symbols)
    ]

    while (passwordCharacters.length < length) {
        passwordCharacters.push(pickRandomCharacter(allCharacters))
    }

    return shuffleCharacters(passwordCharacters).join('')
}

function hasValidUserHeader(worksheet) {
    let usernameHeader = getCellValue(worksheet.getRow(1).getCell(1)).toLowerCase()
    let emailHeader = getCellValue(worksheet.getRow(1).getCell(2)).toLowerCase()
    return usernameHeader === 'username' && emailHeader === 'email'
}

async function getOrCreateDefaultUserRole(session) {
    let userRole = await roleModel.findOne({
        name: { $regex: /^user$/i },
        isDeleted: false
    }).session(session)

    if (!userRole) {
        userRole = new roleModel({
            name: 'USER',
            description: 'Default role for imported users'
        })
        await userRole.save({ session })
    }

    return userRole
}

async function createUserCart(userId, session) {
    let newCart = new cartModel({
        user: userId
    })
    await newCart.save({ session })
}

async function importUsersFromWorksheet(worksheet) {
    let existingUsers = await userModel.find({ isDeleted: false }).select('username email').lean()
    let usernameSet = new Set(existingUsers.map(function (user) {
        return user.username.toLowerCase()
    }))
    let emailSet = new Set(existingUsers.map(function (user) {
        return user.email.toLowerCase()
    }))
    let results = []

    for (let index = 2; index <= worksheet.rowCount; index++) {
        let row = worksheet.getRow(index)
        let username = getCellValue(row.getCell(1))
        let email = getCellValue(row.getCell(2)).toLowerCase()

        if (!username && !email) {
            continue;
        }

        let errorRow = []
        if (!username) {
            errorRow.push('username khong duoc rong')
        }
        if (!email) {
            errorRow.push('email khong duoc rong')
        } else if (!isValidEmail(email)) {
            errorRow.push('email khong dung dinh dang')
        }
        if (username && usernameSet.has(username.toLowerCase())) {
            errorRow.push('username da ton tai')
        }
        if (email && emailSet.has(email)) {
            errorRow.push('email da ton tai')
        }

        if (errorRow.length > 0) {
            results.push({
                row: index,
                success: false,
                username: username,
                email: email,
                message: errorRow.join(', ')
            })
            continue;
        }

        let password = generateRandomPassword(16)
        let session = await mongoose.startSession()
        session.startTransaction()

        try {
            let userRole = await getOrCreateDefaultUserRole(session)
            let newUser = await userController.CreateAnUser(
                username,
                password,
                email,
                userRole._id,
                session
            )

            await createUserCart(newUser._id, session)
            await session.commitTransaction()

            usernameSet.add(username.toLowerCase())
            emailSet.add(email)

            let emailStatus = 'sent'
            let message = 'tao user thanh cong va da gui email mat khau'
            let temporaryPassword
            try {
                await mailHandler.sendImportedUserPasswordMail(email, username, password)
            } catch (error) {
                emailStatus = 'failed'
                message = 'tao user thanh cong nhung gui email that bai: ' + error.message
                temporaryPassword = password
            }

            results.push({
                row: index,
                success: true,
                username: username,
                email: email,
                emailStatus: emailStatus,
                temporaryPassword: temporaryPassword,
                message: message
            })
        } catch (error) {
            await session.abortTransaction()
            results.push({
                row: index,
                success: false,
                username: username,
                email: email,
                message: error.message
            })
        } finally {
            await session.endSession()
        }
    }

    return results
}

router.post('/single', uploadImage.single('file'), function (req, res, next) {
    if (!req.file) {
        res.status(404).send({
            message: "file upload rong"
        })
    } else {
        res.send(req.file.path)
    }
})

router.post('/multiple', uploadImage.array('files'), function (req, res, next) {
    if (!req.files) {
        res.status(404).send({
            message: "file upload rong"
        })
    } else {
        let data = req.body;
        console.log(data);
        let result = req.files.map(f => {
            return {
                filename: f.filename,
                path: f.path,
                size: f.size
            }
        })
        res.send(result)
    }
})

router.get('/:filename', function (req, res, next) {
    let fileName = req.params.filename;
    let pathFile = path.join(__dirname, '../uploads', fileName)
    res.sendFile(pathFile)
})

router.post('/excel/users', uploadExcel.single('file'), async function (req, res, next) {
    if (!req.file) {
        res.status(404).send({
            message: 'file upload rong'
        })
        return
    }

    let pathFile = path.join(__dirname, '../uploads', req.file.filename)

    try {
        let workbook = new excelJS.Workbook();
        await workbook.xlsx.readFile(pathFile);
        let worksheet = workbook.worksheets[0]

        if (!worksheet || worksheet.rowCount < 2) {
            res.status(400).send({
                message: 'file excel khong co du lieu import'
            })
            return
        }

        if (!hasValidUserHeader(worksheet)) {
            res.status(400).send({
                message: 'dong dau tien phai la username, email'
            })
            return
        }

        let results = await importUsersFromWorksheet(worksheet)
        let successCount = results.filter(function (item) {
            return item.success
        }).length

        res.send({
            message: 'import user hoan tat',
            totalRows: results.length,
            successCount: successCount,
            failureCount: results.length - successCount,
            results: results
        })
    } catch (error) {
        res.status(400).send({
            message: error.message
        })
    } finally {
        removeUploadedFile(pathFile)
    }
})

router.post('/excel', uploadExcel.single('file'), async function (req, res, next) {
    if (!req.file) {
        res.status(404).send({
            message: "file upload rong"
        })
    } else {
        let pathFile = path.join(__dirname, '../uploads', req.file.filename)
        try {
            let workbook = new excelJS.Workbook();
            await workbook.xlsx.readFile(pathFile);
            let worksheet = workbook.worksheets[0];
            let products = await productModel.find({});
            let getTitle = products.map(p => p.title)
            let getSku = products.map(p => p.sku)
            let result = [];

            for (let index = 2; index <= worksheet.rowCount; index++) {
                let errorRow = [];
                const row = worksheet.getRow(index)
                let sku = row.getCell(1).value;
                let title = row.getCell(2).value;
                let category = row.getCell(3).value;
                let price = Number.parseInt(row.getCell(4).value);
                let stock = Number.parseInt(row.getCell(5).value);

                if (price < 0 || isNaN(price)) {
                    errorRow.push("dinh dang price chua dung " + price)
                }
                if (stock < 0 || isNaN(stock)) {
                    errorRow.push("dinh dang stock chua dung " + stock)
                }
                if (getTitle.includes(title)) {
                    errorRow.push("title da ton tai")
                }
                if (getSku.includes(sku)) {
                    errorRow.push("sku da ton tai")
                }

                if (errorRow.length > 0) {
                    result.push({ success: false, data: errorRow })
                    continue;
                }

                let session = await mongoose.startSession()
                session.startTransaction()
                try {
                    let newObj = new productModel({
                        sku: sku,
                        title: title,
                        slug: slugify(title, {
                            replacement: '-', remove: undefined,
                            locale: 'vi',
                            trim: true
                        }), price: price,
                        description: title,
                        category: category
                    })
                    let newProduct = await newObj.save({ session });
                    let newInv = new InventoryModel({
                        product: newProduct._id,
                        stock: stock
                    })
                    newInv = await newInv.save({ session })
                    await newInv.populate('product')
                    await session.commitTransaction();
                    getSku.push(sku);
                    getTitle.push(title)
                    result.push({ success: true, data: newInv });
                } catch (error) {
                    await session.abortTransaction();
                    errorRow.push(error.message)
                    result.push({ success: false, data: errorRow })
                } finally {
                    await session.endSession()
                }
            }

            result = result.map(function (e, index) {
                if (e.success) {
                    return (index + 1) + ": " + e.data.product.title
                }
                return (index + 1) + ": " + e.data
            })
            res.send(result)
        } catch (error) {
            res.status(400).send({
                message: error.message
            })
        } finally {
            removeUploadedFile(pathFile)
        }
    }
})

module.exports = router;
