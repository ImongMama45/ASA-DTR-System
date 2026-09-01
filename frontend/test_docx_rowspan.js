import fs from 'fs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell } from 'docx';

const doc = new Document({
    sections: [{
        children: [
            new Table({
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph("Office 1")], rowSpan: 2 }),
                            new TableCell({ children: [new Paragraph("Person A")] }),
                        ],
                    }),
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph("Person B")] }),
                        ],
                    }),
                ],
            }),
        ],
    }],
});

Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync("test.docx", buffer);
    console.log("test.docx created successfully with rowSpan");
}).catch(err => {
    console.error("Error creating docx:", err);
});
