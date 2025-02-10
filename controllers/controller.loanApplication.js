import asyncHandler from '../../middleware/asyncHandler.js';
import User from '../../models/User/model.user.js';
import LoanApplication from '../../models/User/model.loanApplication.js';
import Documents from '../../models/Documents.js';
import Lead from '../../models/Leads.js'
import LeadStatus from '../../models/LeadStatus.js'
import { nextSequence } from "../../utils/nextSequence.js";
import { postLogs } from "../../Controllers/logs.js"
import checkUploadedDocuments from "../../utils/User/isDocumentUploaded.js"
import splitName from "../../utils/splitName.js"
import { postUserLogs } from './controller.userLogs.js';
import UserStatus from '../../models/User/model.userStatus.js';
import { getDocs } from '../../utils/User/docsUploadAndFetch.js';



const calculateLoan = asyncHandler(async (req, res) => {
    const loanDetails = req.body;
    const { principle, totalPayble, roi, tenure } = loanDetails;

    if (
        principle <= 0 ||
        totalPayble <= 0 ||
        roi <= 0 ||
        tenure <= 0
    ) {
        return res.status(400).json({ message: "Invalid input" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(400).json({ message: "User not found" });
    }

    if (!user.isCompleteRegistration) {
        return res.status(400).json({ message: "firstly please complete your registration" })
    }

    let loanApplication
    let previousLoanApplication = await LoanApplication.findOne({ userId: user._id }).sort({ createdAt: -1 });

    if (previousLoanApplication) {
        previousLoanApplication.loanDetails = loanDetails;
        isLoanAlreadyCalculated.isLoanCalculated = true
        await previousLoanApplication.save();
        loanApplication = previousLoanApplication
        return res.status(200).json({ message: "Loan Application updated successfully" });
    }

    else {
        loanApplication = await LoanApplication.create({
            userId: user._id,
            isLoanCalculated: true,
            loanDetails
        });

    }

    return res.status(200).json({ message: "Loan Application created successfully", loanApplication: loanApplication.loanDetails });

});

const addEmploymentInfo = asyncHandler(async (req, res) => {
    const employeInfo = req.body;
    const userId = req.user._id;
    if (!employeInfo || !userId) {
        return res.status(400).json({ message: "Invalid input" });
    }

    // Validation for employment information
    const requiredFields = [
        "workFrom",
        "officeEmail",
        "companyName",
        "companyType",
        "designation",
        "officeAddrress",
        "city",
        "state",
        "pincode"
    ];

    const missingFields = requiredFields.filter((field) => !employeInfo[field] || employeInfo[field].trim() === "");

    if (missingFields.length > 0) {
        return res.status(400).json({
            message: "Missing or empty required fields",
            missingFields,
        });
    }

    const loanDetails = await LoanApplication.findOne(
        { userId: userId },
    ).sort({ createdAt: -1 });

    if (!loanDetails) {
        return res.status(400).json({ message: "Loan Application not found" })
    }

    let progressStatus
    let previousJourney
    if (loanDetails.progressStatus == "CALCULATED") {
        progressStatus = "EMPLOYMENT_DETAILS_SAVED",
            previousJourney = "CALCULATED"
    }

    if (loanDetails.progressStatus != "CALCULATED") {
        progressStatus = loanDetails.progressStatus,
            previousJourney = loanDetails.previousJourney
    }


    const addEmploymentInfo = await LoanApplication.findOneAndUpdate(
        { userId: userId},
        {
            $set: {
                employeeDetails: employeInfo,
                progressStatus: progressStatus,
                previousJourney: previousJourney,
                isEmploymentDetailsSaved: true
            }
        },

        {
            new: true,
            sort: { createdAt: -1 }

        }
    );

    if (!addEmploymentInfo) {
        return res.status(400).json({ message: "Employment Info not added" });
    }
    await postUserLogs(userId, `User add employment info`)
    return res.status(200).json({ message: "Employment Info added successfully", EmploymentInfo: addEmploymentInfo.employeeDetails });
});

const disbursalBankDetails = asyncHandler(async (req, res) => {
    const bankDetails = req.body;
    const userId = req.user._id;
    if (!bankDetails || !userId) {
        return res.status(400).json({ message: "Invalid input" });
    }


    const loanDetails = await LoanApplication.findOne(
        { userId: userId }
    ).sort({ createdAt: -1 });

    if (!loanDetails) {
        return res.status(400).json({ message: "Loan Application not found" })
    }

    let progressStatus
    let previousJourney
    if (loanDetails.progressStatus == "DOCUMENTS_SAVED") {
        progressStatus = "COMPLETED",
            previousJourney = "DISBURSAL_DETAILS_SAVED"
    }

    if (loanDetails.progressStatus != "DOCUMENTS_SAVED") {
        progressStatus = loanDetails.progressStatus,
            previousJourney = loanDetails.previousJourney
    }


    const addBankDetails = await LoanApplication.findOneAndUpdate(
        { userId: userId },
        {
            $set: {
                disbursalBankDetails: bankDetails,
                progressStatus: progressStatus,
                previousJourney: previousJourney,
                isDisbursalDetailsSaved: true

            }
        },

        {
            new: true,
            sort: { createdAt: -1 }

        }
    );

    if (!addBankDetails) {
        return res.status(400).json({ message: "Bank Details not added" });
    }
    await postUserLogs(userId, `User add bank  disbursal details`)

    const userDetails = await User.findById(userId)
    let docs;
    let pan = userDetails.PAN
    const exisitingDoc = await Documents.findOne({ pan: userDetails.PAN });
    if (exisitingDoc) {
        docs = exisitingDoc;
    } else {
        docs = await Documents.create({
            pan: pan,
        });
    }

    const isDocumentUploaded = checkUploadedDocuments(docs.document)
    if (!isDocumentUploaded.isComplete) {
        return res.status(400).json({ message: "Please upload all documents", missingDocument: isDocumentUploaded.missingDocuments })
    }

    // pass extraObject In Lead
    const personalDetails = userDetails.personalDetails
    const employeDetails = loanDetails.employeeDetails
    const disbursalBankDetails = loanDetails.disbursalBankDetails
    const residenceDetails = userDetails.residenceDetails
    const incomeDetails = userDetails.incomeDetails




    // logic of creating lead

    const { fName, mName, lName } = splitName(userDetails.personalDetails.fullName)


    const leadNo = await nextSequence("leadNo", "QUALED", 10);

    const leadStatus = await LeadStatus.create({
        pan: pan,
        leadNo,
        isInProcess: true,
    });


    const [day, month, year] = userDetails.personalDetails.dob.split('-');
    const dob = new Date(`${year}-${month}-${day}`);
    const newLead = await Lead.create({
        userId,
        fName: fName,
        mName: mName,
        lName: lName,
        gender: userDetails.personalDetails.gender,
        dob: dob,
        leadNo,
        aadhaar: userDetails.aadarNumber,
        pan: userDetails.PAN,
        documents: docs._id.toString(),
        mobile: String(userDetails.mobile),
        alternateMobile: userDetails.alternateMobile ? String(alternateMobile) : "",
        personalEmail: userDetails.personalDetails.personalEmail ? userDetails.personalDetails.personalEmail : "",
        officeEmail: loanDetails.employeeDetails.officeEmail ? loanDetails.employeeDetails.officeEmail : "",
        loanAmount: loanDetails.loanDetails.principle,
        salary: userDetails.incomeDetails.monthlyIncome,
        pinCode: userDetails.residenceDetails.pincode,
        state: userDetails.residenceDetails.state,
        city: userDetails.residenceDetails.city,
        source: userDetails.platformType,
        leadStatus: leadStatus._id,
        isAadhaarVerified: true,
        isAadhaarDetailsSaved: true,
        isPanVerified: true,
        isEmailVerified: true,
        isMobileVerified: true,
        extraDetails: {
            personalDetails,
            employeDetails,
            disbursalBankDetails,
            residenceDetails,
            incomeDetails
        }
    });

    if (!newLead) {
        res.status(400).json({ message: "Lead not created" });
        throw new Error("Lead not created!!!");
    }

    await UserStatus.create({
        userId: userId,
        leadNo: newLead.leadNo,
        loanApplicationId: loanDetails._id,
        pan: userDetails.PAN
    })

    // viewLeadsLog(req, res, status || '', borrower || '', leadRemarks = '');
    const logs = await postLogs(
        newLead._id,
        "NEW LEAD",
        `${newLead.fName}${newLead.mName && ` ${newLead.mName}`}${newLead.lName && ` ${newLead.lName}`
        }`,
        "New lead created"
    );


    return res.status(200).json({ message: "Loan Applied successfully!", newLead, logs });
});

const getApplicationStatus = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId)
    if (!user) {
        return res.status(400).json({ message: "User not found" });
    }

    const loanDetails = await LoanApplication.findOne({ userId: userId }).sort({ createdAt: -1 });
    if (!loanDetails) {
        return res.status(400).json({ message: "Loan Application not found" });
    }

    return res.status(200).json({ message: "Loan Application found", applicationStatus: loanDetails.applicationStatus, progressStatus: loanDetails.progressStatus });
});

const getApplicationDetails = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { applicationStatus } = req.query;

    if (!userId) {
        return res.status(400).json({ message: "Invalid input" });
    }

    const loanApplicationDetails = await LoanApplication.findOne(
        { userId}
    ).sort({ createdAt: -1 });

    if (!loanApplicationDetails) {
        return res.status(400).json({ message: "Loan Application not found" });
    }

    let data;

    if (applicationStatus == "loanDetails") {
        data = loanApplicationDetails.loanDetails
        return res.status(200).json({ message: "sucessfully fetched", data });
    }

    if (applicationStatus == "employeeDetails") {
        data = loanApplicationDetails.employeeDetails
        return res.status(200).json({ message: "sucessfully fetched", data });
    }

    if (applicationStatus == "disbursalBankDetails") {
        data = loanApplicationDetails.disbursalBankDetails
        return res.status(200).json({ message: "sucessfully fetched", data });
    }

    data = loanApplicationDetails
    return res.status(200).json({ message: "sucessfully fetched", data });

});

const getDocumentStatus = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const userDetails = await User.findById(userId);
    const pan = userDetails.PAN;
    const data = await Documents.findOne({ pan: pan });

    // implementing aggregation pipeline

    // const pipeline = [
    //     {
    //       $match: {
    //         pan: pan
    //       }
    //     },
    //     {
    //       $project: {
    //         multipleDocumentsStatus: {
    //           $map: {
    //             input: {
    //               $objectToArray:
    //                 "$document.multipleDocuments"
    //             },
    //             as: "doc",
    //             in: {
    //               type: "$$doc.k",
    //               status: {
    //                 $cond: {
    //                   if: {
    //                     $gt: [
    //                       {
    //                         $size: "$$doc.v"
    //                       },
    //                       0
    //                     ]
    //                   },
    //                   then: "Uploaded",
    //                   else: "Not Uploaded"
    //                 }
    //               }
    //             }
    //           }
    //         },
    //         singleDocumentsStatus: {
    //           $map: {
    //             input: "$document.singleDocuments",
    //             as: "doc",
    //             in: {
    //               type: "$$doc.type",
    //               status: "Uploaded"
    //             }
    //           }
    //         }
    //       }
    //     }
    //   ]

    // const reults = await Documents.aggregate(pipeline); 

    const multipleDocs = data.document.multipleDocuments;
    const singleDocs = data.document.singleDocuments;

    // Check multiple documents
    const multipleDocumentsStatus = {};
    for (const [key, value] of Object.entries(multipleDocs)) {
        multipleDocumentsStatus[key] = value.length > 0 ? 'Uploaded' : 'Not Uploaded';
    }

    // Check single documents
    const singleDocumentsStatus = singleDocs.map(doc => ({
        type: doc.type,
        status: 'Uploaded',
    }));

    const response = {
        multipleDocumentsStatus,
        singleDocumentsStatus,
    };

    return res.status(200).json(response);

})



const getDocumentList = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Fetch user details to get PAN
    const userDetails = await User.findById(userId);
    if (!userDetails || !userDetails.PAN) {
        return res.status(404).json({ message: "User or PAN not found" });
    }

    // Find the documents by PAN
    const result = await Documents.findOne(
        { pan: userDetails.PAN }, 
        {
            "document.singleDocuments": 1,
            "document.multipleDocuments": 1,
        }
    );

    if (result) {
        // Process `singleDocuments`
        const singleDocuments = result.document.singleDocuments.map(doc => ({
            id: doc._id || null,
            name: doc.name,
            type: doc.type || null,
            url: doc.url || null,
        }));

        // Process `multipleDocuments` and limit to max 3 per type
        const multipleDocuments = [];
        const multipleDocs = result.document.multipleDocuments;

        for (const [key, docsArray] of Object.entries(multipleDocs)) {
            docsArray.slice(0, 3).forEach(doc => { // Take only the first 3 documents of each type
                multipleDocuments.push({
                    id: doc._id || null,
                    name: doc.name,
                    type: key, // Use the key (e.g., bankStatement, salarySlip) as the type
                    url: doc.url || null,
                });
            });
        }

        // Combine both lists into one array
        const allDocuments = [...multipleDocuments, ...singleDocuments];

        return res.status(200).json({ documents: allDocuments });
    }

    // Return an empty array if no documents match the given PAN
    return res.status(200).json({ documents: [] });
});


// FOR RETURN ONLY MAX 3 MULTIPLE DOCUMENT
/*
const getDocumentList = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Fetch user details to get PAN
    const userDetails = await User.findById(userId);
    if (!userDetails || !userDetails.PAN) {
        return res.status(404).json({ message: "User or PAN not found" });
    }

    // Find the documents by PAN
    const result = await Documents.findOne(
        { pan: userDetails.PAN }, 
        {
            "document.singleDocuments": 1,
            "document.multipleDocuments": 1,
        }
    );

    if (result) {
        // Process `singleDocuments`
        const singleDocuments = result.document.singleDocuments.map(doc => ({
            id: doc._id || null,
            name: doc.name,
            type: doc.type || null,
            url: doc.url || null,
        }));

        // Process `multipleDocuments` and limit to max 3 per type
        const multipleDocuments = [];
        const multipleDocs = result.document.multipleDocuments;

        for (const [key, docsArray] of Object.entries(multipleDocs)) {
            docsArray.slice(0, 3).forEach(doc => { // Take only the first 3 documents of each type
                multipleDocuments.push({
                    id: doc._id || null,
                    name: doc.name,
                    type: key, // Use the key (e.g., bankStatement, salarySlip) as the type
                    url: doc.url || null,
                });
            });
        }

        // Combine both lists into one array
        const allDocuments = [...multipleDocuments, ...singleDocuments];

        return res.status(200).json({ documents: allDocuments });
    }

    // Return an empty array if no documents match the given PAN
    return res.status(200).json({ documents: [] });
});
*/

const documentPreview = asyncHandler(async (req, res) => {

    const { docType } = req.query;
    const docId = req.query.docId;

    let userDetails = await User.findById(req.user._id);


    if (!userDetails) {
        res.status(404);
        throw new Error("Lead not found!!!");
    }
    const docs = await Documents.findOne({ pan: userDetails.PAN });
    console.log(docs);

    const result = await getDocs(docs, docType, docId);

    // Return the pre-signed URL for this specific document
    res.json({
        type: docType,
        url: result.preSignedUrl,
        mimeType: result.mimeType,
    });

})

const getJourney = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const loanDetails = await LoanApplication.findOne({ userId: userId }).sort({ createdAt: -1 });
    const journey = await UserStatus.findOne({ userId: userId , loanApplicationId:loanDetails._id });
    if (!journey) {
        return res.status(400).json({ message: "Loan Application not found" });
    }

    return res.status(200).json({ message: "Loan Application journey found", journey: journey })
});


export { calculateLoan, addEmploymentInfo, getApplicationStatus, getApplicationDetails, disbursalBankDetails, getDocumentStatus, getDocumentList, documentPreview, getJourney }